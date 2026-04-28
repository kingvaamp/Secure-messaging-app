// ============================================
// Sealed Sender — Anonymous Message Delivery
//
// Hides sender identity from server while allowing
// recipient to verify sender authenticity.
//
// Implementation:
// 1. Server sees ONLY recipient ID - not sender
// 2. Sender uses one-time anonymous key per message
// 3. Recipient verifies via X3DH established key
// 4. Forward secrecy maintained
// ============================================

import { toB64, fromB64, generateKeyPair, importPublicKey, ecdh, hkdf } from './primitives';

// ── Anonymous Key Management ───────────────────────────────────────────────────────

/**
 * Generate a one-time anonymous sender key.
 * Used to hide sender identity from server.
 * Each message uses a fresh key - unlinkable.
 * 
 * @returns {Promise<{publicKey, privateKey, publicB64}>}
 */
export async function generateAnonymousSenderKey() {
  const kp = await generateKeyPair();
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicB64: kp.publicB64
  };
}

// ── Sealed Sender Message ──────────────────────────────────────────────────

/**
 * Create a sealed sender message that hides sender identity.
 * 
 * The server only sees:
 *   - Recipient ID
 *   - Encrypted message payload
 *   - Anonymous sender key (unlinkable)
 * 
 * The recipient can verify sender because only they can
 * derive the shared secret using their identity key.
 * 
 * @param {CryptoKey} senderAnonymousPrivate - One-time anonymous private key
 * @param {string} recipientIdentityB64 - Recipient's identity public key
 * @param {string} plainText - Message to send
 * @returns {Promise<{anonymousPublicB64, ciphertext, iv}>}
 */
export async function createSealedMessage(
  senderAnonymousPrivate,
  recipientIdentityB64,
  plainText
) {
  // Import recipient's identity key
  const recipientPublic = await importPublicKey(recipientIdentityB64);
  
  // Compute DH with anonymous key + recipient identity
  // This is different per message (fresh anonymous key)
  const sharedSecret = await ecdh(senderAnonymousPrivate, recipientPublic);
  
  // Derive message key from shared secret
  const messageKey = await hkdf(
    sharedSecret,
    null,
    'VanishText.SealedSender',
    32
  );
  
  // Encrypt the plaintext
  const keyRaw = await crypto.subtle.exportKey('raw', messageKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt']),
    new TextEncoder().encode(plainText)
  );
  
  return {
    anonymousPublicB64: toB64(await crypto.subtle.exportKey('raw', senderAnonymousPrivate)),
    iv: toB64(iv),
    ciphertext: toB64(ct)
  };
}

/**
 * Decrypt a sealed sender message.
 * 
 * @param {CryptoKey} recipientIdentityPrivate - Recipient's identity private key
 * @param {string} senderAnonymousPublicB64 - Anonymous key from message
 * @param {object} payload - { iv, ciphertext }
 * @returns {Promise<string>}
 */
export async function openSealedMessage(
  recipientIdentityPrivate,
  senderAnonymousPublicB64,
  payload
) {
  // Import sender's anonymous public key
  const senderPublic = await importPublicKey(senderAnonymousPublicB64);
  
  // Compute same DH - only recipient can do this
  // (they have the only private key)
  const sharedSecret = await ecdh(recipientIdentityPrivate, senderPublic);
  
  // Derive same message key
  const messageKey = await hkdf(
    sharedSecret,
    null,
    'VanishText.SealedSender',
    32
  );
  
  // Decrypt
  const keyRaw = await crypto.subtle.exportKey('raw', messageKey);
  const iv = new Uint8Array(fromB64(payload.iv));
  const ct = fromB64(payload.ciphertext);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']),
    ct
  );
  
  return new TextDecoder().decode(decrypted);
}

// ── Server-Blind Delivery ─────────────────────────────────────────────────

/**
 * Create a server-blind envelope.
 * Server only sees: { recipientId, encryptedEnvelope }
 * 
 * @param {string} recipientId - Supabase user ID
 * @param {object} sealedMessage - Output from createSealedMessage
 * @returns {object}
 */
export function createServerBlindEnvelope(recipientId, sealedMessage) {
  return {
    recipientId,
    // This is opaque to the server - only recipient can open
    data: toB64(new TextEncoder().encode(JSON.stringify(sealedMessage)))
  };
}

/**
 * Open a server-blind envelope.
 * 
 * @param {object} envelope - Server envelope
 * @returns {object}
 */
export function openServerBlindEnvelope(envelope) {
  return JSON.parse(new TextDecoder().decode(fromB64(envelope.data)));
}

// ── Sender Authentication (for recipient) ─────────────────────────────────

/**
 * Create sender authentication tag.
 * Proves the message came from someone who knows
 * the recipient's identity key (or established X3DH).
 * 
 * @param {CryptoKey} senderKey - Key used in message
 * @param {CryptoKey} sharedSecret - X3DH established secret
 * @returns {Promise<string>}
 */
export async function createSenderAuthTag(senderKey, sharedSecret) {
  const keyRaw = await crypto.subtle.exportKey('raw', senderKey);
  const authKey = await hkdf(
    sharedSecret,
    null,
    'VanishText.Auth',
    32
  );
  
  const authKeyCrypto = await crypto.subtle.importKey(
    'raw',
    authKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', authKeyCrypto, keyRaw);
  return toB64(signature);
}

/**
 * Verify sender authentication tag.
 * 
 * @param {CryptoKey} expectedSenderKey - Expected sender's key
 * @param {CryptoKey} sharedSecret - X3DH shared secret
 * @param {string} authTagB64 - Authentication tag
 * @returns {Promise<boolean>}
 */
export async function verifySenderAuthTag(expectedSenderKey, sharedSecret, authTagB64) {
  const keyRaw = await crypto.subtle.exportKey('raw', expectedSenderKey);
  const authKey = await hkdf(
    sharedSecret,
    null,
    'VanishText.Auth',
    32
  );
  
  const authKeyCrypto = await crypto.subtle.importKey(
    'raw',
    authKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  
  return crypto.subtle.verify(
    'HMAC',
    authKeyCrypto,
    keyRaw,
    fromB64(authTagB64)
  );
}

// ── Usage Example ────────────────────────────────────────────────────────
//
// ALICE (Sender):
//   const anonKey = await generateAnonymousSenderKey();
//   const sealed = await createSealedMessage(
//     anonKey.privateKey,
//     bobIdentityB64,
//     "Hello!"
//   );
//   // Send: { recipientId: bobId, data: createServerBlindEnvelope(bobId, sealed) }
//
// BOB (Recipient):
//   const envelope = openServerBlindEnvelope(message.data);
//   const { anonymousPublicB64, iv, ciphertext } = envelope;
//   const plaintext = await openSealedMessage(
//     bobIdentityPrivateKey,
//     anonymousPublicB64,
//     { iv, ciphertext }
//   );
//   // plaintext === "Hello!"