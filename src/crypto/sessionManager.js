/*
 * REQUIRED DB MIGRATION (run in Supabase SQL editor):
 *
 * -- Original user_keys table (keep for demo/legacy compat)
 * CREATE TABLE IF NOT EXISTS user_keys (
 *   user_id UUID PRIMARY KEY REFERENCES auth.users(id),
 *   public_key_b64 TEXT NOT NULL,
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "users can read all keys" ON user_keys FOR SELECT USING (true);
 * CREATE POLICY "users can write own key" ON user_keys FOR ALL USING (auth.uid() = user_id);
 *
 * -- X3DH bundle table (new)
 * CREATE TABLE x3dh_bundles (
 *   user_id    UUID PRIMARY KEY REFERENCES auth.users(id),
 *   bundle     JSONB NOT NULL,
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * ALTER TABLE x3dh_bundles ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "anyone can read bundles"  ON x3dh_bundles FOR SELECT USING (true);
 * CREATE POLICY "owner can write bundle"   ON x3dh_bundles FOR ALL    USING (auth.uid() = user_id);
 *
 * -- OPK consumption tracking
 * CREATE TABLE opk_claims (
 *   claimer_id UUID,
 *   owner_id   UUID,
 *   opk_key_id INT,
 *   claimed_at TIMESTAMPTZ DEFAULT NOW(),
 *   PRIMARY KEY (claimer_id, owner_id)
 * );
 */

// ============================================
// Session Manager — Full X3DH + Double Ratchet
// Phase 4: Signal Protocol-grade session establishment
//
// Architecture (production path, __DEV_DEMO__ === false):
//   1. On login, generate (or load) a full X3DH identity key pair.
//   2. Generate an X3DH bundle (SPK + 20 OPKs) and publish to Supabase.
//   3. On first message to a contact:
//        Alice: fetch Bob's bundle → x3dhInitiate() → ratchet.initAlice()
//        Bob  : x3dhRespond() on first received message → ratchet.initBob()
//   4. All subsequent messages use the Double Ratchet chains.
//
// Demo path (__DEV_DEMO__ === true):
//   Falls back to the original plain ECDH(identity, contact) flow so the
//   app works without a live x3dh_bundles Supabase table.
// ============================================

import { DoubleRatchet } from './doubleRatchet';
import { generateKeyPair, importPublicKey, ecdh, toB64, fromB64 } from './primitives';
import {
  generateIdentityKeyPair,
  generateX3DHBundle,
  x3dhInitiate,
  x3dhRespond,
} from './x3dh';
import {
  saveIdentityKey,
  loadIdentityKey,
  saveSignedPreKey,
  saveOneTimePreKeys,
  loadSignedPreKey,
  loadOneTimePreKey,
  deleteOneTimePreKey,
} from './keyStorage';
import { supabase } from '@/lib/supabase';

// ── In-memory state (cleared on sign-out) ────────────────────────────────────

/**
 * The current user's X3DH identity key pair.
 * Holds: { publicKeyECDH, privateKeyECDH, publicKeyECDSA, privateKeyECDSA, publicB64, privateJwk }
 */
let myIdentityKeyPair = null;

/**
 * Demo-only: per-contact ephemeral plain-ECDH key pairs generated locally.
 * Used only when __DEV_DEMO__ === true AND the contact has no Supabase key.
 */
const demoContactKeyPairs = new Map();

/** Per-conversation Double Ratchet instances: conversationId → DoubleRatchet */
const ratchets = new Map();

/**
 * Per-conversation X3DH associated data (AD): conversationId → Uint8Array.
 * Used for AEAD binding; stored in memory only.
 */
const sessionADs = new Map();

/**
 * Per-conversation ephemeral public key sent in the first message header.
 * Stored so encryptMessage() can attach it to the first outbound message.
 * conversationId → base64 string
 */
const pendingEphemeralKeys = new Map();

// ── Identity Key Management ──────────────────────────────────────────────────

/**
 * Get (or lazily generate) the current user's X3DH identity key pair.
 *
 * Production path:
 *   1. Return cached in-memory key pair if available.
 *   2. Try to load from encrypted keyStorage (loadIdentityKey).
 *   3. If not found, generate a new X3DH identity key pair and save it.
 *
 * Demo path:
 *   Same logic, but failures are non-fatal — a fresh ephemeral pair is
 *   generated each session (matches previous plain-ECDH demo behaviour).
 *
 * @returns {Promise<{
 *   publicKeyECDH, privateKeyECDH,
 *   publicKeyECDSA, privateKeyECDSA,
 *   publicB64, privateJwk
 * }>}
 */
export async function getMyIdentityKeyPair() {
  if (myIdentityKeyPair) return myIdentityKeyPair;

  // Try to restore from encrypted keyStorage
  const stored = await loadIdentityKey();
  if (stored?.privateJwk && stored?.publicB64) {
    // Re-hydrate CryptoKey objects from the stored JWK
    try {

      // Re-import ECDSA private key from JWK
      const ecdsaPrivKey = await crypto.subtle.importKey(
        'jwk',
        stored.privateJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign']
      );

      // Derive ECDH private key from the same JWK
      const ecdhPrivJwk = { ...stored.privateJwk, key_ops: ['deriveBits'] };
      delete ecdhPrivJwk.alg;
      const ecdhPrivKey = await crypto.subtle.importKey(
        'jwk',
        ecdhPrivJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveBits']
      );

      // Re-import public key (raw bytes)
      const publicRaw = fromB64(stored.publicB64);
      const ecdsaPubKey = await crypto.subtle.importKey(
        'raw',
        publicRaw,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );
      const ecdhPubKey = await crypto.subtle.importKey(
        'raw',
        publicRaw,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );

      myIdentityKeyPair = {
        publicKeyECDH:  ecdhPubKey,
        privateKeyECDH: ecdhPrivKey,
        publicKeyECDSA: ecdsaPubKey,
        privateKeyECDSA: ecdsaPrivKey,
        publicB64:      stored.publicB64,
        privateJwk:     stored.privateJwk,
      };
      return myIdentityKeyPair;
    } catch {
      // Fall through — generate a fresh pair below
    }
  }

  // Generate a fresh X3DH identity key pair
  myIdentityKeyPair = await generateIdentityKeyPair();
  await saveIdentityKey({
    publicB64:  myIdentityKeyPair.publicB64,
    privateJwk: myIdentityKeyPair.privateJwk,
  });

  return myIdentityKeyPair;
}

// ── Demo-mode helpers (plain ECDH fallback) ──────────────────────────────────

/**
 * [DEMO ONLY] Fetch a contact's public key from Supabase user_keys table,
 * falling back to a locally-generated ephemeral key pair.
 */
async function fetchContactPublicKeyDemo(contactId) {
  const { data, error } = await supabase
    .from('user_keys')
    .select('public_key_b64')
    .eq('user_id', contactId)
    .single();

  if (!error && data?.public_key_b64) {
    return data.public_key_b64;
  }

  // Demo fallback: generate (or reuse) a local ephemeral key pair
  if (!demoContactKeyPairs.has(contactId)) {
    const kp = await generateKeyPair();
    demoContactKeyPairs.set(contactId, kp);
  }
  return demoContactKeyPairs.get(contactId).publicB64;
}

// ── Key Server Integration (Supabase) ────────────────────────────────────────

/**
 * Publish a complete X3DH prekey bundle to Supabase.
 *
 * Steps:
 *   1. Get (or generate) the identity key pair.
 *   2. Generate a fresh SPK (id=1) + 20 OPKs.
 *   3. Save private SPK and OPKs to encrypted keyStorage.
 *   4. Upsert the public bundle to x3dh_bundles in Supabase.
 *
 * Also publishes the raw identity public key to user_keys (legacy compat).
 *
 * @param {string} userId — Supabase user UUID (from auth.user.id)
 */
export async function publishX3DHBundle(userId) {
  if (__DEV_DEMO__) {
    // Demo: publish the plain ECDH public key to user_keys (legacy path)
    const kp = await getMyIdentityKeyPair();
    await supabase.from('user_keys').upsert({
      user_id:        userId,
      public_key_b64: kp.publicB64,
      updated_at:     new Date().toISOString(),
    });
    return;
  }

  const identityKeyPair = await getMyIdentityKeyPair();

  // Generate SPK + 20 OPKs
  const { publicBundle, privateKeys } = await generateX3DHBundle(identityKeyPair, 1, 20);

  // Persist private keys locally (encrypted via keyStorage)
  await saveSignedPreKey(privateKeys.signedPreKey);
  await saveOneTimePreKeys(privateKeys.oneTimePreKeys);

  // Upload public bundle to Supabase
  const { error } = await supabase.from('x3dh_bundles').upsert({
    user_id:    userId,
    bundle:     publicBundle,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[X3DH] Failed to publish bundle:', error.message);
  }

  // Also publish raw identity key to user_keys for legacy/demo compat
  await supabase.from('user_keys').upsert({
    user_id:        userId,
    public_key_b64: identityKeyPair.publicB64,
    updated_at:     new Date().toISOString(),
  });
}

/** @deprecated Use publishX3DHBundle instead */
export async function publishMyPublicKey(userId) {
  return publishX3DHBundle(userId);
}

// ── Ratchet Session Management ────────────────────────────────────────────────

/**
 * Get (or create) a Double Ratchet session for a conversation.
 *
 * Production path (X3DH):
 *   role = 'alice' → initiator: fetch Bob's bundle, run x3dhInitiate(), initAlice()
 *   role = 'bob'   → responder: x3dhRespond() from first message header, initBob()
 *
 * Demo path:
 *   Falls back to plain ECDH(myIdentity, contactPublic) as before.
 *
 * @param {string} conversationId
 * @param {string} contactId
 * @param {'alice'|'bob'} [role='alice']
 * @param {object|null}   [aliceHeader=null]  — x3dh header from first received message (Bob path)
 * @returns {Promise<DoubleRatchet>}
 */
async function getOrCreateRatchet(conversationId, contactId, role = 'alice', aliceHeader = null) {
  if (ratchets.has(conversationId)) {
    return ratchets.get(conversationId);
  }

  // ── Demo mode: plain ECDH fallback ──────────────────────────────────────────
  if (__DEV_DEMO__) {
    const myKP = await getMyIdentityKeyPair();
    const contactPubB64 = await fetchContactPublicKeyDemo(contactId);
    const contactPublicKey = await importPublicKey(contactPubB64);
    const sharedBits = await ecdh(myKP.privateKeyECDH, contactPublicKey);

    const ratchet = new DoubleRatchet();
    await ratchet.initialize(sharedBits);
    // Set our ratchet key pair for DH ratchet
    ratchet.sendRatchetKeyPair = myKP;
    ratchets.set(conversationId, ratchet);
    return ratchet;
  }

  // ── Production mode: X3DH session establishment ──────────────────────────────
  const myKP = await getMyIdentityKeyPair();

  if (role === 'alice') {
    // ── Alice path: fetch Bob's bundle and initiate ────────────────────────────
    const { data, error } = await supabase
      .from('x3dh_bundles')
      .select('bundle')
      .eq('user_id', contactId)
      .single();

    if (error || !data?.bundle) {
      throw new Error('X3DH: contact has no published bundle — cannot establish session');
    }

    const theirBundle = data.bundle;

    // Claim one OPK: pop the first available OPK from the bundle and mark it used
    let selectedOPK = null;
    if (theirBundle.oneTimePreKeys && theirBundle.oneTimePreKeys.length > 0) {
      selectedOPK = theirBundle.oneTimePreKeys[0];

      // Remove the claimed OPK from Bob's bundle in Supabase
      const remainingOPKs = theirBundle.oneTimePreKeys.slice(1);
      await supabase.from('x3dh_bundles').update({
        bundle: { ...theirBundle, oneTimePreKeys: remainingOPKs },
        updated_at: new Date().toISOString(),
      }).eq('user_id', contactId);

      // Record the claim (best effort — OPK rotation is non-fatal)
      const mySession = await supabase.auth.getUser();
      if (mySession?.data?.user?.id) {
        await supabase.from('opk_claims').upsert({
          claimer_id: mySession.data.user.id,
          owner_id:   contactId,
          opk_key_id: selectedOPK.keyId,
          claimed_at: new Date().toISOString(),
        }).catch(() => { /* non-fatal */ });
      }
    }

    // Build the bundle object expected by x3dhInitiate
    const initiateBundle = {
      identityPublicB64: theirBundle.identityKey.publicB64,
      signedPreKey:      theirBundle.signedPreKey,          // { keyId, publicB64, signature }
      oneTimePreKey:     selectedOPK,                        // { keyId, publicB64 } or null
    };

    const { sk, ad, ephemeralPublicB64 } = await x3dhInitiate(myKP, initiateBundle);

    // Store ephemeral key so encryptMessage() can attach it to first message
    pendingEphemeralKeys.set(conversationId, ephemeralPublicB64);
    sessionADs.set(conversationId, ad);

    const ratchet = new DoubleRatchet();
    // Initialize with shared secret (sk) - Signal spec
    await ratchet.initialize(sk);
    // Set our ratchet key pair for DH ratchet
    ratchet.sendRatchetKeyPair = myKP;
    ratchets.set(conversationId, ratchet);
    return ratchet;

  } else {
    // ── Bob path: respond to Alice's first message header ─────────────────────
    if (!aliceHeader) {
      throw new Error('X3DH: aliceHeader required for bob path');
    }

    // Load Bob's private SPK and (optionally) OPK from keyStorage
    const mySignedPreKey  = await loadSignedPreKey(aliceHeader.signedPreKeyId ?? 1);
    const myOneTimePreKey = aliceHeader.opkKeyId
      ? await loadOneTimePreKey(aliceHeader.opkKeyId)
      : null;

    const { sk, ad } = await x3dhRespond(
      myKP,
      mySignedPreKey,
      myOneTimePreKey,
      {
        identityPublicB64:  aliceHeader.senderIdentityKey,
        ephemeralPublicB64: aliceHeader.ephemeralKey,
      }
    );

    // Consume the OPK — delete it from storage so it's never reused
    if (myOneTimePreKey && aliceHeader.opkKeyId) {
      await deleteOneTimePreKey(aliceHeader.opkKeyId).catch(() => { /* non-fatal */ });
    }

    sessionADs.set(conversationId, ad);

    // Import Alice's ephemeral public key for the DH ratchet init
    const aliceEphemeralPublic = await importPublicKey(aliceHeader.ephemeralKey);

    const ratchet = new DoubleRatchet();
    // Initialize as Bob with shared secret and Alice's ephemeral key
    await ratchet.initialize(sk);
    // Store Alice's ratchet key for DH ratchet
    ratchet.recvRatchetPublicKey = aliceEphemeralPublic;
    ratchets.set(conversationId, ratchet);
    return ratchet;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext message using the Double Ratchet send chain.
 * On the very first message, attaches an X3DH header to the payload
 * so Bob can derive the shared key without a prior exchange.
 *
 * @param {string} conversationId
 * @param {string} contactId
 * @param {string} plaintext
 * @returns {Promise<{
 *   iv, ciphertext, msgIndex, senderPublicKey,
 *   x3dh: { senderIdentityKey, ephemeralKey } | null
 * }>}
 */
export async function encryptMessage(conversationId, contactId, plaintext) {
  const ratchet = await getOrCreateRatchet(conversationId, contactId, 'alice');
  const ratchetPayload = await ratchet.encrypt(plaintext);

  // Attach X3DH header on the first outbound message only
  let x3dhHeader = null;
  if (!__DEV_DEMO__ && pendingEphemeralKeys.has(conversationId)) {
    const myKP = await getMyIdentityKeyPair();
    x3dhHeader = {
      senderIdentityKey: myKP.publicB64,
      ephemeralKey:      pendingEphemeralKeys.get(conversationId),
    };
    // Clear — header only needs to be sent once
    pendingEphemeralKeys.delete(conversationId);
  }

  return {
    ...ratchetPayload,
    x3dh: x3dhHeader, // null on all subsequent messages
  };
}

/**
 * Decrypt a received message payload using the Double Ratchet recv chain.
 *
 * If payload.x3dh is present and no session exists yet, establishes the
 * session as Bob via x3dhRespond() before decrypting.
 *
 * @param {string} conversationId
 * @param {string} contactId
 * @param {{ iv, ciphertext, msgIndex, senderPublicKey, x3dh? }} payload
 * @returns {Promise<string>} decrypted plaintext
 */
export async function decryptPayload(conversationId, contactId, payload) {
  try {
    // If this is the first message from Alice, establish Bob's session first
    if (!__DEV_DEMO__ && payload.x3dh && !ratchets.has(conversationId)) {
      await getOrCreateRatchet(conversationId, contactId, 'bob', payload.x3dh);
    }

    const ratchet = await getOrCreateRatchet(conversationId, contactId, 'bob', payload.x3dh ?? null);
    return await ratchet.decrypt(payload);
  } catch {
    throw new Error('Double Ratchet decryption failed — possible tampering or key mismatch');
  }
}

/**
 * Get the current user's X3DH identity public key (base64-encoded).
 * Used for safety number computation and identity verification.
 *
 * @returns {Promise<string>} base64 public key
 */
export async function getMyPublicB64() {
  const kp = await getMyIdentityKeyPair();
  return kp.publicB64;
}

/**
 * Get a contact's public key (base64) from the Supabase key server.
 * Used for safety number computation and identity verification.
 *
 * In production: reads from x3dh_bundles.bundle.identityKey.publicB64.
 * In demo:       reads from user_keys (legacy table) with local fallback.
 *
 * @param {string} contactId
 * @returns {Promise<string>} base64 public key
 */
export async function getContactPublicB64(contactId) {
  if (__DEV_DEMO__) {
    return fetchContactPublicKeyDemo(contactId);
  }

  const { data, error } = await supabase
    .from('x3dh_bundles')
    .select('bundle')
    .eq('user_id', contactId)
    .single();

  if (!error && data?.bundle?.identityKey?.publicB64) {
    return data.bundle.identityKey.publicB64;
  }

  throw new Error('Contact has no published X3DH bundle — cannot verify identity');
}

/**
 * Wipe ALL in-memory cryptographic state.
 * Must be called on sign-out, app lock, and before tab close.
 */
export function clearAllSessions() {
  if (myIdentityKeyPair) {
    myIdentityKeyPair.privateJwk = null;
    myIdentityKeyPair.publicB64  = null;
    myIdentityKeyPair = null;
  }
  demoContactKeyPairs.clear();
  ratchets.clear();
  sessionADs.clear();
  pendingEphemeralKeys.clear();
}

/**
 * Check if a ratchet session is active for a conversation.
 */
export function hasSession(conversationId) {
  return ratchets.has(conversationId);
}
