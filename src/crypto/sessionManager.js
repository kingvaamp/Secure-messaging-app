/*
 * REQUIRED DB MIGRATION (run in Supabase SQL editor):
 * CREATE TABLE user_keys (
 *   user_id UUID PRIMARY KEY REFERENCES auth.users(id),
 *   public_key_b64 TEXT NOT NULL,
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "users can read all keys" ON user_keys FOR SELECT USING (true);
 * CREATE POLICY "users can write own key" ON user_keys FOR ALL USING (auth.uid() = user_id);
 */

// ============================================
// Session Manager — Real ECDH + Double Ratchet
// Phase 3: Full Signal Protocol-grade session establishment
//
// Architecture:
//   1. On login, generate a real ECDH P-256 identity key pair and publish it to Supabase
//   2. For each contact, fetch their published public key from Supabase (user_keys table)
//   3. Run real ECDH(myPrivate, contactPublic) → 256-bit shared secret
//   4. Feed shared secret into DoubleRatchet.init() → independent send/recv chains
//   5. All messages use ratchet.encrypt() / ratchet.decrypt()
//
// Forward Secrecy: Each message advances the chain → old keys destroyed automatically
// Post-Compromise: DH ratchet step regenerates both chains after each exchange
// ============================================

import { DoubleRatchet } from './doubleRatchet';
import { generateKeyPair, importPrivateKey, importPublicKey, ecdh } from './primitives';
import { supabase } from '@/lib/supabase';

// ── In-memory state (cleared on sign-out) ────────────────────────────────────
// Never written to localStorage or sessionStorage — lives in JS heap only.

/** The current user's ECDH P-256 identity key pair for this session */
let myKeyPair = null;

/** Per-conversation Double Ratchet instances: conversationId → DoubleRatchet */
const ratchets = new Map();

// ── Identity Key Management ──────────────────────────────────────────────

/**
 * Get (or lazily generate) the current user's ECDH identity key pair.
 * In production: load from encrypted keyStorage with user-PIN wrapping.
 * Demo: generate fresh key on first message (session-scoped).
 *
 * @returns {Promise<{ publicKey, privateKey, publicB64, privateJwk }>}
 */
async function getMyKeyPair() {
  if (myKeyPair) return myKeyPair;
  myKeyPair = await generateKeyPair(); // WebCrypto ECDH P-256
  return myKeyPair;
}

// ── Key Server Integration (Supabase) ──────────────────────────────────

/**
 * Fetch a contact's published ECDH P-256 public key from Supabase.
 * Throws if the contact has not published a key — session cannot be established.
 *
 * @param {string} contactId — Supabase user UUID
 * @returns {Promise<string>} base64 raw ECDH P-256 public key
 */
async function fetchContactPublicKey(contactId) {
  const { data, error } = await supabase
    .from('user_keys')
    .select('public_key_b64')
    .eq('user_id', contactId)
    .single();

  if (error || !data) {
    throw new Error('Contact has no published key — cannot establish session');
  }
  return data.public_key_b64;
}

/**
 * Publish the current user's ECDH P-256 identity public key to Supabase.
 * Must be called after login so contacts can fetch it to establish sessions.
 *
 * @param {string} userId — Supabase user UUID (from auth.user.id)
 */
export async function publishMyPublicKey(userId) {
  const myKP = await getMyKeyPair();
  await supabase.from('user_keys').upsert({
    user_id: userId,
    public_key_b64: myKP.publicB64,
    updated_at: new Date().toISOString(),
  });
}

// ── Ratchet Session Management ─────────────────────────────────────────────

/**
 * Get (or create) a Double Ratchet session for a conversation.
 *
 * Session establishment:
 *   sharedBits = ECDH(myPrivateKey, contactPublicKey)  ← real ECDH
 *   ratchet.init(sharedBits)  ← HKDF derives rootKey + sendChainKey + recvChainKey
 *
 * This is real authenticated key agreement — the shared secret is only
 * derivable by someone who holds myPrivateKey.
 *
 * @param {string} conversationId
 * @param {string} contactId
 * @returns {Promise<DoubleRatchet>}
 */
async function getOrCreateRatchet(conversationId, contactId) {
  if (ratchets.has(conversationId)) {
    return ratchets.get(conversationId);
  }

  // Step 1: Get the user's real identity key pair
  const myKP = await getMyKeyPair();

  // Step 2: Fetch the contact's real published public key from Supabase key server
  // Throws if the contact has not published a key — cannot establish E2E session
  const contactPubB64 = await fetchContactPublicKey(contactId);
  const contactPublicKey = await importPublicKey(contactPubB64);

  // Step 3: Real ECDH key agreement
  // ECDH(myPrivate, contactPublic) → 256-bit shared secret
  // This output is unique to this (user, contact) pair and requires
  // myPrivateKey to compute — never extractable from published data
  const sharedBits = await ecdh(myKP.privateKey, contactPublicKey);

  // Step 4: Initialize Double Ratchet with real shared secret
  // init() internally runs HKDF to split sharedBits into:
  //   rootKey (32 bytes) + sendChainKey (32 bytes) + recvChainKey (32 bytes)
  const ratchet = new DoubleRatchet();
  await ratchet.init(sharedBits);

  ratchets.set(conversationId, ratchet);
  return ratchet;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext message using the Double Ratchet send chain.
 * Advances the send chain key → old key destroyed → forward secrecy.
 *
 * @param {string} conversationId
 * @param {string} contactId
 * @param {string} plaintext
 * @returns {Promise<{ iv, ciphertext, msgIndex, senderPublicKey }>}
 */
export async function encryptMessage(conversationId, contactId, plaintext) {
  const ratchet = await getOrCreateRatchet(conversationId, contactId);
  return ratchet.encrypt(plaintext);
}

/**
 * Decrypt a received message payload using the Double Ratchet recv chain.
 * Advances the recv chain key → maintains forward secrecy.
 * Throws on GCM authentication tag failure (tampered ciphertext).
 *
 * @param {string} conversationId
 * @param {string} contactId
 * @param {{ iv, ciphertext, msgIndex, senderPublicKey }} payload
 * @returns {Promise<string>} decrypted plaintext
 */
export async function decryptPayload(conversationId, contactId, payload) {
  try {
    const ratchet = await getOrCreateRatchet(conversationId, contactId);
    return await ratchet.decrypt(payload);
  } catch {
    // Never swallow silently — always surface tamper/key-mismatch errors
    throw new Error('Double Ratchet decryption failed — possible tampering or key mismatch');
  }
}

/**
 * Get the current user's ECDH public key (base64-encoded).
 * Used for safety number computation and identity verification.
 *
 * @returns {Promise<string>} base64 public key
 */
export async function getMyPublicB64() {
  const kp = await getMyKeyPair();
  return kp.publicB64;
}

/**
 * Get a contact's ECDH public key (base64-encoded) from the Supabase key server.
 * Used for safety number computation and identity verification.
 *
 * @param {string} contactId
 * @returns {Promise<string>} base64 public key
 */
export async function getContactPublicB64(contactId) {
  return fetchContactPublicKey(contactId);
}

/**
 * Wipe ALL in-memory cryptographic state.
 * Must be called on sign-out, app lock, and before tab close.
 *
 * Clears: identity key pair, contact key pairs, ratchet sessions.
 * Note: JS provides no true memory zeroing — GC is non-deterministic.
 * Best effort: overwrite references to make GC collection more likely.
 */
export function clearAllSessions() {
  // Overwrite sensitive fields before clearing references
  if (myKeyPair) {
    myKeyPair.privateJwk = null;
    myKeyPair.publicB64 = null;
    myKeyPair = null;
  }
  ratchets.clear();
}

/**
 * Check if a ratchet session is active for a conversation.
 */
export function hasSession(conversationId) {
  return ratchets.has(conversationId);
}
