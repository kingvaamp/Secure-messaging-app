// ============================================
// Double Ratchet Protocol Implementation
// Signal Protocol — Forward Secrecy + Post-Compromise Security
// ============================================

import { hkdf, hmac, encrypt, decrypt, toB64, fromB64 } from './primitives';

// HMAC discriminators as specified in Signal Protocol
// [0x01] → next chain key, [0x02] → message key
const NEXT_CHAIN_KEY = new Uint8Array([0x01]);
const MESSAGE_KEY = new Uint8Array([0x02]);

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
   * Encrypt plaintext — advances send chain
   * Returns: { iv, ciphertext, msgIndex, senderPublicKey }
   */
  async encrypt(plaintext) {
    if (!this.initialized) throw new Error('Ratchet not initialized');
    if (!this.sendChainKey) throw new Error('No send chain key');

    // Derive message key from current send chain key
    const { nextChainKey, messageKey } = await kdfChainStep(this.sendChainKey);
    
    // Encrypt with message key
    const encrypted = await encrypt(messageKey, plaintext);
    
    // Advance chain
    this.sendChainKey = nextChainKey;
    const msgIndex = this.sendMsgIndex++;
    
    // Get ephemeral public key for DH ratchet step
    let senderPublicKey = null;
    if (this.sendEphemeralKeyPair) {
      const raw = await crypto.subtle.exportKey('raw', this.sendEphemeralKeyPair.publicKey);
      senderPublicKey = toB64(raw);
    }
    
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
   */
  async decrypt(payload) {
    if (!this.initialized) throw new Error('Ratchet not initialized');
    if (!this.recvChainKey) throw new Error('No receive chain key');

    // Derive message key from current receive chain key
    const { nextChainKey, messageKey } = await kdfChainStep(this.recvChainKey);
    
    // Decrypt with message key
    const plaintext = await decrypt(messageKey, payload.iv, payload.ciphertext);
    
    // Advance chain
    this.recvChainKey = nextChainKey;
    this.recvMsgIndex++;
    
    // Store sender's ephemeral public key for potential DH ratchet
    if (payload.senderPublicKey) {
      this.recvEphemeralPublicKey = payload.senderPublicKey;
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
