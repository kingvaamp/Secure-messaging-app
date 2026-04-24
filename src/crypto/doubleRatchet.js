// ============================================
// Double Ratchet Protocol Implementation
// Signal Protocol — Forward Secrecy + Post-Compromise Security
// ============================================

import { hkdf, hmac, encrypt, decrypt, toB64, fromB64, generateKeyPair, importPublicKey, ecdh } from './primitives';

// HMAC discriminators as specified in Signal Protocol
// [0x01] → next chain key, [0x02] → message key
const NEXT_CHAIN_KEY = new Uint8Array([0x01]);
const MESSAGE_KEY    = new Uint8Array([0x02]);

/**
 * Encode a message index as a 4-byte big-endian Uint8Array.
 * Used as the Associated Data (header) for AES-GCM — binds each
 * ciphertext to its position in the chain, preventing replay / reorder.
 */
function encodeHeader(msgIndex) {
  const buf = new Uint8Array(4);
  buf[0] = (msgIndex >>> 24) & 0xff;
  buf[1] = (msgIndex >>> 16) & 0xff;
  buf[2] = (msgIndex >>>  8) & 0xff;
  buf[3] =  msgIndex         & 0xff;
  return buf;
}

/**
 * KDF chain step — Signal Protocol specification
 *
 * Uses HMAC-SHA256 (NOT HKDF) with discriminator constants.
 * This matches the Signal spec exactly:
 *   nextChainKey = HMAC-SHA256(chainKey, 0x01)
 *   messageKey   = HMAC-SHA256(chainKey, 0x02)
 *
 * Each step is a one-way function — advancing the chain destroys
 * the ability to re-derive old message keys (forward secrecy).
 */
async function kdfChainStep(chainKey) {
  const nextChainKey = await hmac(chainKey, NEXT_CHAIN_KEY); // ArrayBuffer (32 bytes)
  const messageKey   = await hmac(chainKey, MESSAGE_KEY);    // ArrayBuffer (32 bytes)
  return { nextChainKey, messageKey };
}


/**
 * Double Ratchet class
 * Manages independent send and receive chains
 * Each message key is used once then discarded
 */
export class DoubleRatchet {
  constructor() {
    this.rootKey = null;
    this.sendChainKey = null;
    this.recvChainKey = null;
    this.sendMsgIndex = 0;
    this.recvMsgIndex = 0;
    this.sendEphemeralKeyPair = null;
    this.recvEphemeralPublicKey = null;
    this._lastSeenDHKey = null; // tracks last seen sender ephemeral key — triggers DH ratchet on change
    this.initialized = false;
  }

  /**
   * Initialize the ratchet from a shared secret (ECDH output)
   * @param {ArrayBuffer} sharedSecret — 256-bit ECDH shared secret
   */
  async init(sharedSecret) {
    const keys = await hkdf(sharedSecret, null, 'VanishText-v1-DoubleRatchet', 96);
    const keyBytes = new Uint8Array(keys);

    this.rootKey = keyBytes.slice(0, 32).buffer;
    this.sendChainKey = keyBytes.slice(32, 64).buffer;
    this.recvChainKey = keyBytes.slice(64, 96).buffer;
    this.sendMsgIndex = 0;
    this.recvMsgIndex = 0;
    this._lastSeenDHKey = null;
    this.initialized = true;
  }

  /**
   * Initialize as Alice (initiator)
   * @param {ArrayBuffer} sharedSecret
   * @param {CryptoKeyPair} ephemeralKeyPair — Alice's ephemeral key pair
   */
  async initAlice(sharedSecret, ephemeralKeyPair) {
    await this.init(sharedSecret);
    this.sendEphemeralKeyPair = ephemeralKeyPair;
  }

  /**
   * Initialize as Bob (responder)
   * @param {ArrayBuffer} sharedSecret
   * @param {CryptoKey} theirEphemeralPublicKey — Alice's ephemeral public key
   */
  async initBob(sharedSecret, theirEphemeralPublicKey) {
    await this.init(sharedSecret);
    this.recvEphemeralPublicKey = theirEphemeralPublicKey;
  }

  /**
   * DH Ratchet Step — Signal Protocol spec.
   *
   * Triggered when decrypt() observes a new sender ephemeral public key.
   * Performs two sequential ECDH+HKDF derivations:
   *   1. Old sendEphemeralKeyPair + theirNewKey → new rootKey + recvChainKey
   *   2. NEW sendEphemeralKeyPair   + theirNewKey → new rootKey + sendChainKey
   *
   * Both chain counters reset to 0. This gives post-compromise security:
   * even if the old send chain was compromised, the new chains are fresh.
   *
   * @param {string} theirNewPublicKeyB64 — base64 raw ECDH P-256 public key
   */
  async _dhRatchetStep(theirNewPublicKeyB64) {
    // Import their new ephemeral public key
    const importedTheirKey = await importPublicKey(theirNewPublicKeyB64);

    // --- Step 1: derive new recvChainKey using CURRENT send ephemeral key ---
    const dhOut1 = await ecdh(this.sendEphemeralKeyPair.privateKey, importedTheirKey);
    const derived1 = await hkdf(dhOut1, this.rootKey, 'VanishText-DHRatchet', 64);
    const d1 = new Uint8Array(derived1);
    this.rootKey      = d1.slice(0, 32).buffer;
    this.recvChainKey = d1.slice(32, 64).buffer;

    // --- Step 2: generate a fresh send ephemeral key, derive new sendChainKey ---
    this.sendEphemeralKeyPair = await generateKeyPair();
    const dhOut2 = await ecdh(this.sendEphemeralKeyPair.privateKey, importedTheirKey);
    const derived2 = await hkdf(dhOut2, this.rootKey, 'VanishText-DHRatchet', 64);
    const d2 = new Uint8Array(derived2);
    this.rootKey      = d2.slice(0, 32).buffer;
    this.sendChainKey = d2.slice(32, 64).buffer;

    // Reset per-chain message counters
    this.sendMsgIndex = 0;
    this.recvMsgIndex = 0;
  }

  /**
   * Encrypt plaintext — advances send chain
   * Returns: { iv, ciphertext, msgIndex, senderPublicKey }
   */
  async encrypt(plaintext) {
    if (!this.initialized) throw new Error('Ratchet not initialized');
    if (!this.sendChainKey) throw new Error('No send chain key');

    // Derive message key from current send chain key
    const { nextChainKey, messageKey } = await kdfChainStep(this.sendChainKey);

    // Build associated data: 4-byte big-endian message index
    const msgIndex = this.sendMsgIndex;
    const ad = encodeHeader(msgIndex);

    // Encrypt with message key + AD
    const encrypted = await encrypt(messageKey, plaintext, new Uint8Array(ad));

    // Advance chain
    this.sendChainKey = nextChainKey;
    this.sendMsgIndex++;

    // Always include the current ephemeral public key so the receiver
    // can detect DH ratchet steps. Generate one on first use if needed.
    if (!this.sendEphemeralKeyPair) {
      this.sendEphemeralKeyPair = await generateKeyPair();
    }
    const raw = await crypto.subtle.exportKey('raw', this.sendEphemeralKeyPair.publicKey);
    const senderPublicKey = toB64(raw);

    return {
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      msgIndex,
      senderPublicKey,
    };
  }

  /**
   * Decrypt payload — advances receive chain
   * @param {Object} payload — { iv, ciphertext, msgIndex, senderPublicKey }
   * Returns: plaintext string
   * Throws: if GCM authentication tag fails (tampered/wrong AD)
   */
  async decrypt(payload) {
    if (!this.initialized) throw new Error('Ratchet not initialized');
    if (!this.recvChainKey) throw new Error('No receive chain key');

    // Derive message key from current receive chain key
    const { nextChainKey, messageKey } = await kdfChainStep(this.recvChainKey);

    // Reconstruct the same AD that was used during encryption
    const ad = encodeHeader(payload.msgIndex ?? this.recvMsgIndex);

    // Decrypt with message key + AD — throws on auth tag failure
    const plaintext = await decrypt(messageKey, payload.iv, payload.ciphertext, new Uint8Array(ad));

    // Advance chain
    this.recvChainKey = nextChainKey;
    this.recvMsgIndex++;

    // DH Ratchet: if the sender has rotated their ephemeral key, perform
    // a full DH ratchet step to derive fresh root + chain keys.
    if (payload.senderPublicKey && payload.senderPublicKey !== this._lastSeenDHKey) {
      await this._dhRatchetStep(payload.senderPublicKey);
      this._lastSeenDHKey = payload.senderPublicKey;
    }

    return plaintext;
  }

  /**
   * Serialize ratchet state for encrypted storage
   * Does NOT include key material as CryptoKey objects — converts to storable format
   */
  serialize() {
    if (!this.initialized) return null;
    return {
      rootKey: toB64(this.rootKey),
      sendChainKey: toB64(this.sendChainKey),
      recvChainKey: toB64(this.recvChainKey),
      sendMsgIndex: this.sendMsgIndex,
      recvMsgIndex: this.recvMsgIndex,
      _lastSeenDHKey: this._lastSeenDHKey ?? null,
      initialized: this.initialized,
    };
  }

  /**
   * Restore ratchet state from serialized JSON
   */
  restore(json) {
    if (!json || !json.initialized) return false;

    this.rootKey = fromB64(json.rootKey);
    this.sendChainKey = fromB64(json.sendChainKey);
    this.recvChainKey = fromB64(json.recvChainKey);
    this.sendMsgIndex = json.sendMsgIndex || 0;
    this.recvMsgIndex = json.recvMsgIndex || 0;
    this._lastSeenDHKey = json._lastSeenDHKey ?? null;
    this.initialized = true;
    return true;
  }

  /**
   * Check if ratchet is initialized and ready
   */
  isReady() {
    return this.initialized;
  }
}

/**
 * Create a new ratchet session from an ECDH shared secret
 * Convenience function for establishing a new conversation
 */
export async function createRatchetSession(sharedSecret, isAlice = false, keyPair = null) {
  const ratchet = new DoubleRatchet();
  
  if (isAlice && keyPair) {
    await ratchet.initAlice(sharedSecret, keyPair);
  } else {
    await ratchet.init(sharedSecret);
  }
  
  return ratchet;
}
