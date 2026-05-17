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

    // Out-of-order message recovery maps (Signal Spec)
    // Map: ratchetPublicKeyB64 -> { chainKey: ArrayBuffer, recvMessageNumber: number }
    this.oldRecvChains = {}; 
    // Map: `${ratchetPublicKeyB64}_${messageNumber}` -> ArrayBuffer (messageKey)
    this.skippedMessageKeys = {};
    
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

    // DEBUG: fingerprint the derived chain keys
    console.log('[Ratchet.init] sendChainKey fingerprint:', toB64(new Uint8Array(this.sendChainKey).slice(0, 6)));
    console.log('[Ratchet.init] recvChainKey fingerprint:', toB64(new Uint8Array(this.recvChainKey).slice(0, 6)));
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
   *
   * CRITICAL FIX (2026-05-17): initAsBob sendChainKey derivation corrected.
   *
   * 1. initialize() gives both parties the SAME bytes for send/recv chains.
   *    Alice encrypts with sendChainKey (bytes 32-64), so Bob's recvChainKey
   *    MUST also be bytes 32-64. We swap them here.
   *
   * 2. Bob derives his initial sendChainKey using kdfRootKey — the exact same
   *    function Alice's performDHRatchet Step 1 uses. This guarantees symmetry:
   *    Bob.sendChainKey == Alice.recvChainKey (after her first DH ratchet step).
   */
  async initAsBob(x3dhSecret, theirRatchetPublicKeyB64) {
    await this.initialize(x3dhSecret);

    // Swap send/recv chains for Bob's perspective:
    //   Alice.sendChainKey (bytes 32-64) → Bob.recvChainKey
    //   Alice.recvChainKey (bytes 64-96) → Bob.sendChainKey (placeholder, replaced below)
    const tmp = this.sendChainKey;
    this.sendChainKey = this.recvChainKey;
    this.recvChainKey = tmp;

    // Store Alice's ratchet public key so decrypt() can detect key changes
    this.recvRatchetPublicKey = await importPublicKey(theirRatchetPublicKeyB64);

    // Signal spec §3.3 — Bob's initial send chain.
    //
    // When Alice receives Bob's first reply, decrypt() calls performDHRatchet().
    // performDHRatchet Step 1 computes:
    //   recvChainKey = kdfRootKey( DH(Alice.EK_priv, Bob.newKey_pub), rootKey, DH_RATCHET_INFO )[32:64]
    //
    // Bob MUST derive his sendChainKey the same way:
    //   sendChainKey = kdfRootKey( DH(Bob.newKey_priv, Alice.EK_pub), rootKey, DH_RATCHET_INFO )[32:64]
    //
    // ECDH symmetry: DH(Bob.newKey_priv, Alice.EK_pub) == DH(Alice.EK_priv, Bob.newKey_pub) ✓
    // rootKey:       Both sides share the same rootKey from initialize(SK)                  ✓
    // Therefore:     Bob.sendChainKey === Alice.recvChainKey (after her DH ratchet step)   ✓
    //
    // Previous fix used hkdf(dhOut, zeroes, 'VanishText.Bob.InitSendChain') — completely
    // different HKDF salt + info → different key → permanent OperationError.
    this.sendRatchetKeyPair = await generateKeyPair();
    const dhOut    = await ecdh(this.sendRatchetKeyPair.privateKey, this.recvRatchetPublicKey);
    const derived  = await kdfRootKey(dhOut, this.rootKey, DH_RATCHET_INFO);
    const dBytes   = new Uint8Array(derived);
    this.rootKey      = dBytes.slice(0, 32).buffer; // Stay in sync with Alice's performDHRatchet
    this.sendChainKey = dBytes.slice(32, 64).buffer;
    this.sendMessageNumber = 0;
    // recvChainKey and recvMessageNumber intentionally NOT changed here.

    // DEBUG fingerprints
    console.log('[Ratchet.initAsBob] sendChainKey:', toB64(new Uint8Array(this.sendChainKey).slice(0, 6)));
    console.log('[Ratchet.initAsBob] recvChainKey:', toB64(new Uint8Array(this.recvChainKey).slice(0, 6)));
    console.log('[Ratchet.initAsBob] rootKey:',      toB64(new Uint8Array(this.rootKey).slice(0, 6)));
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
    // DEBUG: fingerprint the message key
    console.log('[Ratchet.encrypt] msgKey fingerprint:', toB64(new Uint8Array(messageKey).slice(0, 6)), 'msgNum:', messageNumber);
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
   * Decrypt message - Signal 3.3.4 (corrected order)
   * 
   * Signal spec order:
   * 1. DH ratchet step (if sender's ratchet key changed)
   * 2. Derive message key from (possibly updated) recv chain
   * 3. Decrypt with message key + AD
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
    
    // Step 0: Check skipped message keys for intra-chain out-of-order delivery
    const payloadKeyB64 = payload.ratchetPublicKey;
    if (payloadKeyB64 && payload.messageNumber !== undefined) {
      const skipKey = payloadKeyB64 + '_' + payload.messageNumber;
      if (this.skippedMessageKeys[skipKey]) {
        console.log('[Ratchet.decrypt] Using skipped message key for out-of-order message', skipKey);
        const messageKey = this.skippedMessageKeys[skipKey];
        delete this.skippedMessageKeys[skipKey]; // Consume it
        
        const associatedData = encodeMessageNumber(payload.messageNumber);
        return decrypt(messageKey, payload.iv, payload.ciphertext, associatedData);
      }
    }

    let isOldChain = false;

    // Step 1: DH ratchet step (Signal spec — MUST happen before key derivation)
    if (payloadKeyB64) {
      const newKey = await importPublicKey(payloadKeyB64);

      if (!this.recvRatchetPublicKey) {
        // First time seeing ANY ratchet key from the remote party.
        console.log('[Ratchet.decrypt] First ratchet key received — performing DH ratchet (Bug12 fix)');
        this.recvRatchetPublicKey = newKey;
        await this.performDHRatchet();
      } else {
        const currentKeyB64 = toB64(await crypto.subtle.exportKey('raw', this.recvRatchetPublicKey));
        
        if (payloadKeyB64 !== currentKeyB64) {
          // Is it an OLD key? (Cross-chain out-of-order delivery)
          if (this.oldRecvChains[payloadKeyB64]) {
            console.log('[Ratchet.decrypt] Message uses OLD ratchet key — decrypting from saved old chain');
            isOldChain = true;
          } else {
            console.log('[Ratchet.decrypt] DH ratchet key CHANGED — performing DH ratchet BEFORE decrypt');
            
            // Save the current chain to oldRecvChains BEFORE overwriting it,
            // so we can still decrypt delayed messages that belong to it!
            this.oldRecvChains[currentKeyB64] = {
              chainKey: this.recvChainKey.slice(0), // clone the buffer
              recvMessageNumber: this.recvMessageNumber
            };
            
            // Keep only the last 5 old chains to prevent unbounded memory growth
            const keys = Object.keys(this.oldRecvChains);
            if (keys.length > 5) {
              delete this.oldRecvChains[keys[0]];
            }

            this.recvRatchetPublicKey = newKey;
            await this.performDHRatchet();
          }
        } else {
          console.log('[Ratchet.decrypt] DH ratchet key unchanged — no DH ratchet needed');
        }
      }
    }

    // Determine which chain and counter we are using
    let currentChainKey = isOldChain ? this.oldRecvChains[payloadKeyB64].chainKey : this.recvChainKey;
    let startingMessageNumber = isOldChain ? this.oldRecvChains[payloadKeyB64].recvMessageNumber : this.recvMessageNumber;

    // Step 2: Reconstruct Associated Data
    const messageNumber = payload.messageNumber ?? startingMessageNumber;
    const associatedData = encodeMessageNumber(messageNumber);
    console.log('[Ratchet.decrypt] messageNumber:', messageNumber, 'startingMessageNumber:', startingMessageNumber);
    
    if (messageNumber < startingMessageNumber) {
      throw new Error(`Message number ${messageNumber} too old (expecting >= ${startingMessageNumber}). Possible replay attack or lost skipped key.`);
    }

    // Step 3: Derive message key from (possibly updated) recv chain
    console.log('[Ratchet.decrypt] Deriving message key from chain...');
    
    let msgKey, nxtChainKey;
    
    for (let i = startingMessageNumber; i <= messageNumber; i++) {
      const derived = await kdfMessageKey(currentChainKey);
      
      // If we are skipping messages to catch up to this one, save their keys!
      if (i < messageNumber) {
        const pkB64 = isOldChain ? payloadKeyB64 : toB64(await crypto.subtle.exportKey('raw', this.recvRatchetPublicKey));
        this.skippedMessageKeys[pkB64 + '_' + i] = derived.messageKey;
        console.log('[Ratchet.decrypt] Saved skipped message key for', pkB64 + '_' + i);
      }
      
      msgKey = derived.messageKey;
      nxtChainKey = derived.nextChainKey;
      currentChainKey = nxtChainKey;
    }
    
    // Clean up skippedMessageKeys (keep max 40)
    const skipKeys = Object.keys(this.skippedMessageKeys);
    if (skipKeys.length > 40) {
      delete this.skippedMessageKeys[skipKeys[0]];
    }
    
    const messageKey = msgKey;
    const nextChainKey = nxtChainKey;
    // DEBUG: fingerprint the message key
    console.log('[Ratchet.decrypt] msgKey fingerprint:', toB64(new Uint8Array(messageKey).slice(0, 6)), 'msgNum:', messageNumber);
    
    // Step 4: Decrypt
    const plaintext = await decrypt(
      messageKey,
      payload.iv,
      payload.ciphertext,
      associatedData
    );
    console.log('[Ratchet.decrypt] SUCCESS!');
    
    // Step 5: Advance chain (forward secrecy for received messages too)
    if (isOldChain) {
      this.oldRecvChains[payloadKeyB64].chainKey = nextChainKey;
      this.oldRecvChains[payloadKeyB64].recvMessageNumber = messageNumber + 1;
    } else {
      this.recvChainKey = nextChainKey;
      this.recvMessageNumber = messageNumber + 1;
    }
    
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

    // Serialize skippedMessageKeys (convert ArrayBuffer to base64)
    const serializedSkipped = {};
    if (this.skippedMessageKeys) {
      for (const [k, v] of Object.entries(this.skippedMessageKeys)) {
        serializedSkipped[k] = toB64(v);
      }
    }
    
    // Serialize oldRecvChains
    const serializedOldChains = {};
    if (this.oldRecvChains) {
      for (const [k, v] of Object.entries(this.oldRecvChains)) {
        serializedOldChains[k] = {
          chainKey: toB64(v.chainKey),
          recvMessageNumber: v.recvMessageNumber
        };
      }
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
      skippedMessageKeys: serializedSkipped,
      oldRecvChains: serializedOldChains,
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
    
    // Restore out-of-order maps
    this.skippedMessageKeys = {};
    if (state.skippedMessageKeys) {
      for (const [k, v] of Object.entries(state.skippedMessageKeys)) {
        this.skippedMessageKeys[k] = fromB64(v);
      }
    }
    
    this.oldRecvChains = {};
    if (state.oldRecvChains) {
      for (const [k, v] of Object.entries(state.oldRecvChains)) {
        this.oldRecvChains[k] = {
          chainKey: fromB64(v.chainKey),
          recvMessageNumber: v.recvMessageNumber
        };
      }
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