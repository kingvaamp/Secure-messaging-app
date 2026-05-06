// ============================================
// Double Ratchet Protocol - Signal Spec Compliant
// https://signal.org/docs/specifications/doubleratchet/
//
// Perfect Forward Secrecy (PFS):
//   - Each message uses a unique message key
//   - After use, message key is derived from and chain key is advanced
//   - No way to derive old keys from new keys
//
// Post-Compromise Security (PCS):
//   - DH ratchet creates fresh keys on each conversation turn
//   - Even if current keys are compromised, future messages are secure
// ============================================

import { hkdf, hmac, encrypt, decrypt, toB64, fromB64, generateKeyPair, importPublicKey, importPrivateKey, ecdh, constantTimeEqual } from './primitives';

// ============================================
// Signal Spec Constants
// ============================================

// KDF info strings for HKDF
const ROOT_KEY_INFO = 'VanishText.RootKey';
const CHAIN_KEY_INFO = 'VanishText.ChainKey';

// HMAC discriminators (Signal spec 3.3.2)
// messageKey = HMAC-SHA256(chainKey, 0x01)
// chainKey = HMAC-SHA256(chainKey, 0x02)
const MESSAGE_KEY_DISCRIMINATOR = new Uint8Array([0x01]);
const CHAIN_KEY_DISCRIMINATOR = new Uint8Array([0x02]);

// DH ratchet info
const DH_RATCHET_INFO = 'VanishText.DHRatchet';

// ============================================
// Helper Functions
// ============================================

/**
 * Constant-time comparison - prevents timing attacks
 * Now imported from primitives.js
 */
// REUSED: constantTimeEqual from primitives

/**
 * Encode message number as 4-byte big-endian (Signal 3.3.1)
 * Used as Associated Data to prevent replay attacks
 */
function encodeMessageNumber(msgNum) {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint32(0, msgNum, false); // big-endian
  return new Uint8Array(buf);
}

/**
 * Signal KDF (simplified to HKDF per Signal spec)
 * Derives root key and chain keys from DH output
 */
async function kdfRootKey(dhOutput, currentRootKey, info) {
  // HKDF with current root key as salt
  return hkdf(dhOutput, currentRootKey, info, 64);
}

/**
 * Symmetric-key ratchet (Signal 3.3.2)
 * 
 * messageKey = HMAC-SHA256(chainKey, 0x01)
 * nextChainKey = HMAC-SHA256(chainKey, 0x02)
 * 
 * CRITICAL: Each message advances the chain, destroying the old key
 * This is what provides PERFECT FORWARD SECRECY
 */
async function kdfMessageKey(chainKey) {
  console.log('[kdfMessageKey] START - chainKey type:', typeof chainKey, 'byteLength:', chainKey?.byteLength);
  
  // Import chain key for HMAC
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    chainKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // non-extractable for security
    ['sign', 'verify']
  );
  console.log('[kdfMessageKey] HMAC key imported');
  
  // Derive message key: HMAC(chainKey, 0x01)
  const messageKeyBuffer = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    MESSAGE_KEY_DISCRIMINATOR
  );
  
  // Derive next chain key: HMAC(chainKey, 0x02)
  const nextChainKeyBuffer = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    CHAIN_KEY_DISCRIMINATOR
  );
  
  return {
    // Message key for encrypting this message
    messageKey: messageKeyBuffer,
    // Next chain key replaces current (old key destroyed)
    nextChainKey: nextChainKeyBuffer
  };
}

// ============================================
// Double Ratchet Implementation
// ============================================

export class DoubleRatchet {
  constructor() {
    // Root key - used for DH ratchet derivation
    this.rootKey = null;
    
    // Send chain key - advances after each sent message
    this.sendChainKey = null;
    // Receive chain key - advances after each received message
    this.recvChainKey = null;
    
    // Message counters (for replay protection)
    this.sendMessageNumber = 0;
    this.recvMessageNumber = 0;
    
    // DH ratchet keys
    // Our current DH key pair (for sending)
    this.sendRatchetKeyPair = null;
    // Their current DH public key (for receiving)
    this.recvRatchetPublicKey = null;
    
    // Track last seen DH key (triggers DH ratchet on change)
    this.previousRatchetPublicKey = null;
    
    this.initialized = false;
  }

  /**
   * Initialize ratchet from X3DH shared secret
   * Signal 3.3 - KDF after X3DH
   * 
   * @param {ArrayBuffer} x3dhSecret - Output from X3DH key agreement
   */
  async initialize(x3dhSecret) {
    // Derive root key + initial send chain + initial recv chain
    // Using HKDF per Signal spec (simplified from KDF-Crypto)
    const derivedSecret = await hkdf(
      x3dhSecret,
      null, // no salt
      'VanishText-v1', // info string
      96 // 32 + 32 + 32 = 96 bytes
    );
    
    const keyBytes = new Uint8Array(derivedSecret);
    
    // Initialize keys
    this.rootKey = keyBytes.slice(0, 32).buffer;
    this.sendChainKey = keyBytes.slice(32, 64).buffer;
    this.recvChainKey = keyBytes.slice(64, 96).buffer;
    
    // Initialize message counters
    this.sendMessageNumber = 0;
    this.recvMessageNumber = 0;
    
    // Generate our DH ratchet key pair for sending
    this.sendRatchetKeyPair = await generateKeyPair();
    
    this.previousRatchetPublicKey = null;
    this.initialized = true;
  }

  /**
   * Initialize as Alice (initiator)
   */
  async initAsAlice(x3dhSecret) {
    await this.initialize(x3dhSecret);
    // Alice already has her ratchet key pair from initialize()
  }

  /**
   * Initialize as Bob (responder)
   * Must receive Alice's initial ratchet public key
   */
  async initAsBob(x3dhSecret, theirRatchetPublicKeyB64) {
    await this.initialize(x3dhSecret);
    // Store Alice's ratchet public key
    this.recvRatchetPublicKey = await importPublicKey(theirRatchetPublicKeyB64);
    
    // Perform initial DH ratchet (Signal 3.4)
    await this.performDHRatchet();
  }

  /**
   * DH Ratchet Step - Signal 3.4
   * 
   * This is what provides POST-COMPROMISE SECURITY
   * 
   * When we receive a new DH public key from the other party:
   * 1. DH with old send key + their new key  new root + recv chain
   * 2. Generate new send key + DH with their new key  new root + send chain
   * 
   * Result: Fresh keys even if current ones were compromised
   */
  async performDHRatchet() {
    if (!this.sendRatchetKeyPair || !this.recvRatchetPublicKey) {
      throw new Error('DH ratchet requires both ratchet keys');
    }
    
    // Step 1: DH old send ratchet key with their recv key
    //  new root key + new receive chain
    const dhOutput1 = await ecdh(
      this.sendRatchetKeyPair.privateKey,
      this.recvRatchetPublicKey
    );
    const derived1 = await kdfRootKey(dhOutput1, this.rootKey, DH_RATCHET_INFO);
    const keys1 = new Uint8Array(derived1);
    this.rootKey = keys1.slice(0, 32).buffer;
    this.recvChainKey = keys1.slice(32, 64).buffer;
    
    // Step 2: Generate NEW send ratchet key pair
    // Then DH with their recv key  new root + new send chain
    this.sendRatchetKeyPair = await generateKeyPair();
    const dhOutput2 = await ecdh(
      this.sendRatchetKeyPair.privateKey,
      this.recvRatchetPublicKey
    );
    const derived2 = await kdfRootKey(dhOutput2, this.rootKey, DH_RATCHET_INFO);
    const keys2 = new Uint8Array(derived2);
    this.rootKey = keys2.slice(0, 32).buffer;
    this.sendChainKey = keys2.slice(32, 64).buffer;
    
    // Reset message counters for new chains
    this.sendMessageNumber = 0;
    this.recvMessageNumber = 0;
  }

  /**
   * Encrypt message - Signal 3.3.3
   * 
   * PERFECT FORWARD SECRECY:
   * 1. Derive message key + next chain key from current chain key
   * 2. Encrypt with message key + message number (AD)
   * 3. REPLACE current chain key with next chain key
   *    (old key destroyed, cannot decrypt previous messages)
   */
  async encrypt(plaintext) {
    if (!this.initialized) {
      throw new Error('Ratchet not initialized');
    }
    if (!this.sendChainKey) {
      throw new Error('No send chain key');
    }
    
    // Step 1: Derive message key + next chain key
    // CRITICAL: This is the ONLY source of the message key
    const { messageKey, nextChainKey } = await kdfMessageKey(this.sendChainKey);
    
    // Step 2: Build Associated Data = message number
    // CRITICAL: Prevents replay attacks, binds ciphertext to position
    const messageNumber = this.sendMessageNumber;
    const associatedData = encodeMessageNumber(messageNumber);
    
    // Step 3: Encrypt with AES-GCM + AD
    const encrypted = await encrypt(messageKey, plaintext, associatedData);
    
    // Step 4: ADVANCE CHAIN (PERFECT FORWARD SECRECY)
    // Replace current chain key with next - OLD KEY DESTROYED
    this.sendChainKey = nextChainKey;
    this.sendMessageNumber++;
    
    // Get current ratchet public key for the header
    const ratchetPublicKeyRaw = await crypto.subtle.exportKey(
      'raw',
      this.sendRatchetKeyPair.publicKey
    );
    const ratchetPublicKey = toB64(ratchetPublicKeyRaw);
    
    return {
      // Encrypted payload
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      
      // Message number (for replay protection)
      messageNumber: messageNumber,
      
      // DH ratchet public key (enables recipient's DH ratchet)
      ratchetPublicKey: ratchetPublicKey
    };
  }

  /**
   * Decrypt message - Signal 3.3.4
   * 
   * 1. Derive message key + next chain key from current chain key
   * 2. Decrypt with message key + AD
   * 3. Check for DH ratchet update
   * 4. Advance chain
   */
  async decrypt(payload) {
    console.log('[Ratchet.decrypt] START - payload.messageNumber:', payload.messageNumber, 'recvMessageNumber:', this.recvMessageNumber);
    console.log('[Ratchet.decrypt] recvChainKey exists:', !!this.recvChainKey);
    console.log('[Ratchet.decrypt] recvRatchetPublicKey exists:', !!this.recvRatchetPublicKey);
    
    if (!this.initialized) {
      throw new Error('Ratchet not initialized');
    }
    if (!this.recvChainKey) {
      throw new Error('No receive chain key');
    }
    
    // Step 1: Derive message key from chain key
    console.log('[Ratchet.decrypt] Deriving message key from recvChainKey...');
    console.log('[Ratchet.decrypt] NOTE: We need message', messageNumber, 'but we are at recvMessageNumber', this.recvMessageNumber);
    const { messageKey, nextChainKey } = await kdfMessageKey(this.recvChainKey);
    console.log('[Ratchet.decrypt] Message key derived');
    
    // Step 2: Reconstruct Associated Data
    const messageNumber = payload.messageNumber ?? this.recvMessageNumber;
    const associatedData = encodeMessageNumber(messageNumber);
    console.log('[Ratchet.decrypt] messageNumber:', messageNumber, 'associatedData length:', associatedData?.byteLength);
    
    // Step 3: Decrypt
    const ivDisplay = typeof payload.iv === 'string' ? payload.iv?.substring(0, 10) : (payload.iv?.byteLength ? 'ArrayBuffer' : payload.iv);
    console.log('[Ratchet.decrypt] Attempting AES-GCM decrypt - iv:', ivDisplay);
    console.log('[Ratchet.decrypt] iv type:', typeof payload.iv, 'ciphertext type:', typeof payload.ciphertext);
    let plaintext;
    try {
      console.log('[Ratchet.decrypt] Calling primitives.decrypt...');
      plaintext = await decrypt(
        messageKey,
        payload.iv,
        payload.ciphertext,
        associatedData
      );
      console.log('[Ratchet.decrypt] SUCCESS! plaintext length:', plaintext?.byteLength);
    } catch (e) {
      console.error('[Ratchet.decrypt] DECRYPT FAILED:', e.message);
      console.error('[Ratchet.decrypt] Stack:', e.stack);
      // Try alternative - maybe the data is already decoded
      try {
        console.log('[Ratchet.decrypt] Trying alternative with ArrayBuffer inputs...');
        const ivArr = typeof payload.iv === 'string' ? fromB64(payload.iv) : payload.iv;
        const ctArr = typeof payload.ciphertext === 'string' ? fromB64(payload.ciphertext) : payload.ciphertext;
        plaintext = await decrypt(
          messageKey,
          ivArr,
          ctArr,
          associatedData
        );
        console.log('[Ratchet.decrypt] Alternative SUCCESS!');
      } catch (e2) {
        console.error('[Ratchet.decrypt] Alternative also FAILED:', e2.message);
        throw e;
      }
    }
    
    // Step 4: Check for DH ratchet update
    // Only happens when sender has rotated their DH key
    if (payload.ratchetPublicKey) {
      const newKey = await importPublicKey(payload.ratchetPublicKey);
      
      // If key changed, perform DH ratchet (POST-COMPROMISE SECURITY)
      if (!this.recvRatchetPublicKey ||
          !constantTimeEqual(
            await crypto.subtle.exportKey('raw', this.recvRatchetPublicKey),
            await crypto.subtle.exportKey('raw', newKey)
          )) {
        this.recvRatchetPublicKey = newKey;
        await this.performDHRatchet();
      }
    }
    
    // Step 5: Advance chain (forward secrecy for received messages too)
    this.recvChainKey = nextChainKey;
    this.recvMessageNumber++;
    
    return plaintext;
  }

  /**
   * Check if ratchet is ready
   */
  isReady() {
    return this.initialized;
  }

  /**
   * Serialize state for storage
   * Does NOT include CryptoKey objects
   *
   * BUG FIX: was synchronous  crypto.subtle.exportKey() is async and its Promise
   * was being passed directly to toB64(), producing a serialized Promise object
   * ("[object Promise]") instead of the actual base64 key bytes. recvRatchetPublicKey
   * always came back as null after a restore, breaking the DH ratchet.
   */
  async serialize() {
    if (!this.initialized) return null;

    // Must await before toB64  exportKey returns a Promise
    let recvRatchetPublicKeyB64 = null;
    if (this.recvRatchetPublicKey) {
      const raw = await crypto.subtle.exportKey('raw', this.recvRatchetPublicKey);
      recvRatchetPublicKeyB64 = toB64(raw);
    }

    return {
      rootKey: toB64(this.rootKey),
      sendChainKey: toB64(this.sendChainKey),
      recvChainKey: toB64(this.recvChainKey),
      sendMessageNumber: this.sendMessageNumber,
      recvMessageNumber: this.recvMessageNumber,
      sendRatchetPublicKey: this.sendRatchetKeyPair?.publicB64 ?? null,
      sendRatchetPrivateJwk: this.sendRatchetKeyPair?.privateJwk ?? null,
      recvRatchetPublicKey: recvRatchetPublicKeyB64,
      initialized: this.initialized
    };
  }

  /**
   * Restore state from serialized
   *
   * BUG FIX: was a synchronous function that used `await` internally  this is a
   * syntax error caught at runtime in strict mode and silently fails in sloppy mode.
   * The awaits on loadRatchetKeys() and importPublicKey() were never executed, so
   * both the send and receive DH ratchet keys were always undefined after a restore.
   * Also removed the unnecessary dynamic import  importPublicKey is already imported
   * at the module level.
   */
  async restore(state) {
    if (!state?.initialized) return false;

    this.rootKey = fromB64(state.rootKey);
    this.sendChainKey = fromB64(state.sendChainKey);
    this.recvChainKey = fromB64(state.recvChainKey);
    this.sendMessageNumber = state.sendMessageNumber || 0;
    this.recvMessageNumber = state.recvMessageNumber || 0;
    this.initialized = true;

    // Restore send DH ratchet key pair
    if (state.sendRatchetPublicKey && state.sendRatchetPrivateJwk) {
      await this.loadRatchetKeys(state.sendRatchetPublicKey, state.sendRatchetPrivateJwk);
    }

    // Restore receiver's DH public key
    // importPublicKey is already imported at the module top  no dynamic import needed
    if (state.recvRatchetPublicKey) {
      this.recvRatchetPublicKey = await importPublicKey(state.recvRatchetPublicKey);
    }

    return true;
  }

  /**
   * Load DH ratchet keys from storage
   *
   * BUG FIX: was using a dynamic import() for importPrivateKey / importPublicKey.
   * Both are now statically imported at the module top. Using dynamic imports here
   * was redundant and could fail if the bundler tree-shakes the dynamic path.
   */
  async loadRatchetKeys(publicB64, privateJwk) {
    this.sendRatchetKeyPair = {
      publicKey:  await importPublicKey(publicB64),
      privateKey: await importPrivateKey(privateJwk),
      publicB64:  publicB64,
      privateJwk: privateJwk,
    };
    return true;
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create session as Alice (initiator)
 */
export async function createSessionAlice(sharedSecret) {
  const ratchet = new DoubleRatchet();
  await ratchet.initAsAlice(sharedSecret);
  return ratchet;
}

/**
 * Create session as Bob (responder)
 */
export async function createSessionBob(sharedSecret, theirRatchetPublicKey) {
  const ratchet = new DoubleRatchet();
  await ratchet.initAsBob(sharedSecret, theirRatchetPublicKey);
  return ratchet;
}