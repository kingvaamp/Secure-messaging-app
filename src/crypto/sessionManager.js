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
// Session Manager  Full X3DH + Double Ratchet
// Phase 4: Signal Protocol-grade session establishment
//
// Architecture (production path, __DEV_DEMO__ === false):
//   1. On login, generate (or load) a full X3DH identity key pair.
//   2. Generate an X3DH bundle (SPK + 20 OPKs) and publish to Supabase.
//   3. On first message to a contact:
//        Alice: fetch Bob's bundle  x3dhInitiate()  ratchet.initAlice()
//        Bob  : x3dhRespond() on first received message  ratchet.initBob()
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
  generateAnonymousSenderKey,
  createSealedMessage,
  openSealedMessage,
} from './sealedSender';
import {
  saveIdentityKey,
  loadIdentityKey,
  saveSignedPreKey,
  saveOneTimePreKeys,
  loadSignedPreKey,
  loadOneTimePreKey,
  deleteOneTimePreKey,
  saveRatchetSession,
  loadRatchetSession,
  hasRatchetSession,
} from './keyStorage';
import { supabase } from '@/lib/supabase';

//  In-memory state (cleared on sign-out) 

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

/** Per-conversation Double Ratchet instances: conversationId  DoubleRatchet */
const ratchets = new Map();

/**
 * Per-conversation X3DH associated data (AD): conversationId  Uint8Array.
 * Used for AEAD binding; stored in memory only.
 */
const sessionADs = new Map();

/**
 * Per-conversation ephemeral public key sent in the first message header.
 * Stored so encryptMessage() can attach it to the first outbound message.
 * conversationId  base64 string
 */
const pendingEphemeralKeys = new Map();

/**
 * Persist a ratchet session to encrypted storage.
 */
async function saveSessionState(conversationId, ratchet) {
  if (!ratchet.initialized) return;
  const state = await ratchet.serialize();
  // Also store the AD if we have it
  if (sessionADs.has(conversationId)) {
    state.ad = toB64(sessionADs.get(conversationId));
  }
  // Store pending X3DH header info if present
  if (pendingEphemeralKeys.has(conversationId)) {
    state.pendingX3DH = pendingEphemeralKeys.get(conversationId);
  }
  await saveRatchetSession(conversationId, state);
}

/**
 * Load and restore a ratchet session from storage.
 */
async function loadSessionState(conversationId) {
  const state = await loadRatchetSession(conversationId);
  if (!state) return null;

  const ratchet = new DoubleRatchet();
  await ratchet.restore(state);
  
  if (state.ad) {
    sessionADs.set(conversationId, new Uint8Array(fromB64(state.ad)));
  }
  if (state.pendingX3DH) {
    pendingEphemeralKeys.set(conversationId, state.pendingX3DH);
  }
  
  ratchets.set(conversationId, ratchet);
  return ratchet;
}

//  Identity Key Management 

/**
 * Get (or lazily generate) the current user's X3DH identity key pair.
 *
 * Production path:
 *   1. Return cached in-memory key pair if available.
 *   2. Try to load from encrypted keyStorage (loadIdentityKey).
 *   3. If not found, generate a new X3DH identity key pair and save it.
 *
 * Demo path:
 *   Same logic, but failures are non-fatal  a fresh ephemeral pair is
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
      // Fall through  generate a fresh pair below
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

//  Demo-mode helpers (plain ECDH fallback) 

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

//  Key Server Integration (Supabase) 

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
 * @param {string} userId  Supabase user UUID (from auth.user.id)
 */
export async function publishX3DHBundle(userId) {
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
    console.error('🚨 [Vanish Security] Failed to publish X3DH bundle to Supabase:', error.message);
    if (error.code === '42501' || error.message.includes('400') || error.code?.startsWith('PGRST')) {
      console.error('🚨 This is likely due to missing or incorrect RLS policies on the `x3dh_bundles` table. Please run the complete `schema.sql` migration in your Supabase SQL Editor. Failure to publish bundles will cause "Message chiffré" (decryption failures) for your contacts.');
    }
  }
}

/** @deprecated Use publishX3DHBundle instead */
export async function publishMyPublicKey(userId) {
  return publishX3DHBundle(userId);
}

//  Ratchet Session Management 

/**
 * Get (or create) a Double Ratchet session for a conversation.
 *
 * Production path (X3DH):
 *   role = 'alice'  initiator: fetch Bob's bundle, run x3dhInitiate(), initAlice()
 *   role = 'bob'    responder: x3dhRespond() from first message header, initBob()
 *
 * Demo path:
 *   Falls back to plain ECDH(myIdentity, contactPublic) as before.
 *
 * @param {string} conversationId
 * @param {string} contactId
 * @param {'alice'|'bob'} [role='alice']
 * @param {object|null}   [aliceHeader=null]   x3dh header from first received message (Bob path)
 * @returns {Promise<DoubleRatchet>}
 */
async function getOrCreateRatchet(conversationId, contactId, role = 'alice', aliceHeader = null) {
  if (ratchets.has(conversationId)) {
    return ratchets.get(conversationId);
  }

  // Check encrypted storage for persisted session
  const persisted = await loadSessionState(conversationId);
  if (persisted) return persisted;

  // Production mode: X3DH session establishment
  const myKP = await getMyIdentityKeyPair();

  if (role === 'alice') {
    // ── Alice path: fetch Bob's bundle and initiate ──────────────────────
    const { data, error } = await supabase
      .from('x3dh_bundles')
      .select('bundle')
      .eq('user_id', contactId)
      .single();

    // ── Fallback A: No bundle at all (new user / first login / offline) ──
    // Signal spec allows a degraded session using only the contact's long-term
    // identity key when no prekey bundle is available. Forward secrecy is
    // reduced (no SPK/OPK) but the conversation still opens and is E2E encrypted.
    // This session will be automatically upgraded when the contact publishes a bundle.
    if (error || !data?.bundle) {
      console.warn('[X3DH] No bundle for contact — falling back to identity-key-only session:', contactId);

      // Try to get the contact's raw identity key from the legacy user_keys table
      const { data: legacyKey } = await supabase
        .from('user_keys')
        .select('public_key_b64')
        .eq('user_id', contactId)
        .single();

      if (!legacyKey?.public_key_b64) {
        // Truly no key material available — cannot establish any session.
        throw new Error('X3DH: contact has no published key material — cannot establish session');
      }

      // Degraded ECDH: DH(myIdentity, theirIdentity) as shared secret.
      // No SPK, no OPK, no forward secrecy — but encrypted and functional.
      const theirIdentityPublic = await importPublicKey(legacyKey.public_key_b64);
      const sk = await ecdh(myKP.privateKeyECDH, theirIdentityPublic);
      const ad = new Uint8Array(0); // no associated data in degraded mode

      // Generate an ephemeral key to send in the header so Bob can derive the same secret
      const ephemeralKP = await generateKeyPair();
      const ephemeralDH = await ecdh(ephemeralKP.privateKey, theirIdentityPublic);

      // Mark this as a degraded session (no SPK/OPK IDs to include)
      pendingEphemeralKeys.set(conversationId, {
        ephemeralPublicB64: ephemeralKP.publicB64,
        signedPreKeyId: null,
        opkKeyId: null,
        degraded: true, // signal to header builder that this is fallback mode
      });
      sessionADs.set(conversationId, ad);

      const ratchet = new DoubleRatchet();
      await ratchet.initialize(ephemeralDH);
      ratchets.set(conversationId, ratchet);
      await saveSessionState(conversationId, ratchet);
      return ratchet;
    }

    const theirBundle = data.bundle;

    // ── Fallback B: Bundle exists but OPKs are exhausted ────────────────
    // Signal Protocol §3.3 explicitly allows X3DH initiation without an OPK.
    // We proceed with IK + SPK only. `selectedOPK` stays null — x3dhInitiate
    // handles this case by omitting the OPK DH step.
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
        try {
          const { error: claimError } = await supabase.from('opk_claims').upsert({
            claimer_id: mySession.data.user.id,
            owner_id:   contactId,
            opk_key_id: selectedOPK.keyId,
            claimed_at: new Date().toISOString(),
          });
          if (claimError) {
             console.error('🚨 [Vanish Security] Failed to claim OPK in Supabase:', claimError.message);
             if (claimError.code === '42501' || claimError.message.includes('400') || claimError.code?.startsWith('PGRST')) {
               console.error('🚨 Check RLS policies on the `opk_claims` table (run schema.sql).');
             }
          }
        } catch { /* non-fatal */ }
      }
    } else {
      // OPKs exhausted — log a warning, continue with IK+SPK only.
      console.warn('[X3DH] OPKs exhausted for contact — initiating without OPK (Signal spec §3.3):', contactId);
    }

    // Guard: SPK must exist — without it we cannot do X3DH at all.
    if (!theirBundle.signedPreKey?.publicB64) {
      throw new Error('X3DH: contact bundle is missing SPK — cannot establish session');
    }

    // Build the bundle object expected by x3dhInitiate
    const initiateBundle = {
      identityPublicB64: theirBundle.identityKey.publicB64,
      signedPreKey:      theirBundle.signedPreKey, // { keyId, publicB64, signature }
      oneTimePreKey:     selectedOPK,              // { keyId, publicB64 } or null — both valid
    };

    const { sk, ad, ephemeralPublicB64 } = await x3dhInitiate(myKP, initiateBundle);

    // Store ephemeral key and IDs so encryptMessage() can attach it to messages
    // until we receive Bob's first ratchet step.
    pendingEphemeralKeys.set(conversationId, {
      ephemeralPublicB64,
      signedPreKeyId: theirBundle.signedPreKey.keyId,
      opkKeyId:       selectedOPK ? selectedOPK.keyId : null,
    });
    sessionADs.set(conversationId, ad);

    const ratchet = new DoubleRatchet();
    await ratchet.initialize(sk);
    ratchets.set(conversationId, ratchet);

    // Persist immediately
    await saveSessionState(conversationId, ratchet);

    return ratchet;

  } else {
    //  Bob path: respond to Alice's first message header 
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

    // Consume the OPK  delete it from storage so it's never reused
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

//  Public API 

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

  // Attach X3DH header as long as we haven't seen Bob's ratchet public key
  let x3dhHeader = null;
  if (pendingEphemeralKeys.has(conversationId)) {
    const pending = pendingEphemeralKeys.get(conversationId);
    x3dhHeader = {
      senderIdentityKey:  (await getMyIdentityKeyPair()).publicB64,
      ephemeralKey:       pending.ephemeralPublicB64,
      signedPreKeyId:     pending.signedPreKeyId,
      opkKeyId:           pending.opkKeyId,
    };
    
    if (ratchet.recvRatchetPublicKey) {
      pendingEphemeralKeys.delete(conversationId);
    }
  }

  // Persist updated state (chain key advanced)
  await saveSessionState(conversationId, ratchet);

  // ── Sealed Sender Outer Envelope ──────────────────────────────────────
  // Fetch the recipient's identity public key so we can seal the envelope.
  // If the lookup fails (e.g. no bundle yet), fall back to sending the raw
  // ratchet payload so the conversation still works.
  let sealedEnvelope = null;
  try {
    const { data } = await supabase
      .from('x3dh_bundles')
      .select('bundle')
      .eq('user_id', contactId)
      .single();

    if (data?.bundle?.identityKey?.publicB64) {
      const recipientIdentityB64 = data.bundle.identityKey.publicB64;

      // Generate a fresh anonymous key per message — unlinkable across sends.
      const anonKey = await generateAnonymousSenderKey();

      // Seal the inner ratchet payload (JSON-stringified) with the anonymous key.
      const innerJson = JSON.stringify({ ...ratchetPayload, x3dh: x3dhHeader });
      sealedEnvelope = await createSealedMessage(anonKey, recipientIdentityB64, innerJson);
    }
  } catch (e) {
    console.warn('[SealedSender] Envelope creation failed, falling back to plain payload:', e.message);
  }

  // If sealing succeeded, return only the opaque envelope — server sees no plaintext or sender key.
  // If sealing failed, return the raw ratchet payload (graceful degradation).
  if (sealedEnvelope) {
    return { sealedEnvelope, x3dh: null }; // x3dh is inside the sealed envelope
  }

  return {
    ...ratchetPayload,
    x3dh: x3dhHeader,
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
    let innerPayload = payload;

    // ── Sealed Sender: Open the outer envelope first ───────────────────
    // If the payload has a sealedEnvelope, the sender wrapped the ratchet
    // payload in an anonymous ECDH envelope. We open it with our identity
    // private key to recover the original ratchet payload + x3dh header.
    if (payload?.sealedEnvelope) {
      try {
        const myKP = await getMyIdentityKeyPair();
        const innerJson = await openSealedMessage(
          myKP.privateKeyECDH,
          payload.sealedEnvelope.anonymousPublicB64,
          { iv: payload.sealedEnvelope.iv, ciphertext: payload.sealedEnvelope.ciphertext }
        );
        innerPayload = JSON.parse(innerJson);
      } catch (e) {
        console.warn('[SealedSender] Failed to open sealed envelope, trying raw payload:', e.message);
        // Fall through with the original payload — graceful degradation
      }
    }

    // If this is the first message from Alice, establish Bob's session first
    if (innerPayload.x3dh && !ratchets.has(conversationId)) {
      await getOrCreateRatchet(conversationId, contactId, 'bob', innerPayload.x3dh);
    }

    const ratchet = await getOrCreateRatchet(conversationId, contactId, 'bob', innerPayload.x3dh ?? null);
    const plaintext = await ratchet.decrypt(innerPayload, sessionADs.get(conversationId));
    
    // Persist updated state (chain key advanced, possibly DH ratchet stepped)
    await saveSessionState(conversationId, ratchet);
    
    return plaintext;
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
  // Production path: read from X3DH bundle on Supabase

  const { data, error } = await supabase
    .from('x3dh_bundles')
    .select('bundle')
    .eq('user_id', contactId)
    .single();

  if (!error && data?.bundle?.identityKey?.publicB64) {
    return data.bundle.identityKey.publicB64;
  }

  throw new Error('Contact has no published X3DH bundle  cannot verify identity');
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
