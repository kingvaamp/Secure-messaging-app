// ============================================
// Encrypted Key Storage — localStorage with AES-256-GCM
// Private keys are NEVER stored in plaintext
// ============================================

import { hkdf, encrypt, decrypt, toB64, fromB64 } from './primitives';

const STORAGE_PREFIX = 'vanish_';
const IDENTITY_KEY = 'identity_key';
const RATCHET_PREFIX = 'ratchet_';
const SALT_KEY = 'storage_salt';

/**
 * Get (or create) the storage wrapping key.
 * Uses a random 32-byte key stored in sessionStorage.
 * sessionStorage is cleared when the browser tab closes,
 * making stored key material inaccessible after the session ends.
 *
 * This is NOT derived from any public data (unlike the previous approach
 * which used window.location.origin — a public, attacker-observable value).
 *
 * Limitation: still vulnerable to XSS that reads sessionStorage.
 * Production hardening: replace with user-PIN-derived PBKDF2 or WebAuthn.
 */
async function getWrappingKey() {
  const SESSION_WRAP_KEY = 'vanish_wrap_key_v2';
  let keyB64 = sessionStorage.getItem(SESSION_WRAP_KEY);

  if (!keyB64) {
    // Generate a fresh random 256-bit key for this session
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    keyB64 = toB64(rawKey);
    sessionStorage.setItem(SESSION_WRAP_KEY, keyB64);
  }

  return fromB64(keyB64);
}


/**
 * Encrypt data before storing
 */
async function secureStore(key, data) {
  const wrapKey = await getWrappingKey();
  const json = JSON.stringify(data);
  const encrypted = await encrypt(wrapKey, json);
  
  const payload = {
    iv: encrypted.iv,
    ct: encrypted.ciphertext,
    t: Date.now(), // timestamp for potential key rotation
  };
  
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(payload));
}

/**
 * Decrypt data from storage
 */
async function secureLoad(key) {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  if (!stored) return null;
  
  try {
    const payload = JSON.parse(stored);
    const wrapKey = await getWrappingKey();
    const json = await decrypt(wrapKey, payload.iv, payload.ct);
    return JSON.parse(json);
  } catch {
    // Silent fail — never log crypto errors to console in production
    // (console logs are readable by extensions and error trackers)
    return null;
  }
}

// ============================================
// Public API
// ============================================

/**
 * Save identity key pair (encrypted)
 * @param {Object} keyPair — { publicB64, privateJwk }
 */
export async function saveIdentityKey(keyPair) {
  await secureStore(IDENTITY_KEY, {
    publicB64: keyPair.publicB64,
    privateJwk: keyPair.privateJwk,
  });
}

/**
 * Load identity key pair (decrypted)
 * Returns: { publicB64, privateJwk } or null
 */
export async function loadIdentityKey() {
  return secureLoad(IDENTITY_KEY);
}

/**
 * Save a ratchet session for a conversation
 * @param {string} conversationId
 * @param {Object} ratchetState — serialized ratchet state
 */
export async function saveRatchetSession(conversationId, ratchetState) {
  await secureStore(RATCHET_PREFIX + conversationId, ratchetState);
}

/**
 * Load a ratchet session for a conversation
 * @param {string} conversationId
 */
export async function loadRatchetSession(conversationId) {
  return secureLoad(RATCHET_PREFIX + conversationId);
}

/**
 * Check if a ratchet session exists
 */
export async function hasRatchetSession(conversationId) {
  const stored = localStorage.getItem(STORAGE_PREFIX + RATCHET_PREFIX + conversationId);
  return stored !== null;
}

/**
 * Delete a ratchet session
 */
export async function deleteRatchetSession(conversationId) {
  localStorage.removeItem(STORAGE_PREFIX + RATCHET_PREFIX + conversationId);
}

/**
 * Wipe ALL keys — called on logout
 * Removes all Vanish-related localStorage entries
 */
export async function wipeAllKeys() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => {
    // Best-effort memory zeroing:
    // Overwrite with random noise before removing to reduce the window
    // during which GC might return the original plaintext from heap memory.
    // Note: JS provides no guaranteed memory zeroing — this is best-effort only.
    try {
      const noise = toB64(crypto.getRandomValues(new Uint8Array(64)).buffer);
      localStorage.setItem(key, noise);
    } catch { /* ignore write errors */ }
    localStorage.removeItem(key);
  });
}

/**
 * Check if identity key exists
 */
export async function hasIdentityKey() {
  return localStorage.getItem(STORAGE_PREFIX + IDENTITY_KEY) !== null;
}
