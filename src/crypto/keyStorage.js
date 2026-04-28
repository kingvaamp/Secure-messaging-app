// ============================================
// Encrypted Key Storage — IndexedDB wrapping key + localStorage ciphertext
//
// Security architecture (two-layer envelope encryption):
//
//   Layer 1 — Master Wrapping Key (MWK):
//     AES-GCM-256, extractable=false, stored as a CryptoKey object in IndexedDB.
//     Because it is non-extractable, JS code can NEVER read the raw key bytes —
//     not even through devtools or XSS. The browser's crypto engine holds it in
//     protected memory and exposes only wrapKey/unwrapKey operations.
//
//   Layer 2 — Per-record key (RK):
//     Fresh random 32-byte AES-GCM key, generated for every store() call.
//     Used to encrypt the JSON payload, then wrapped (encrypted) by the MWK.
//     The wrapped (encrypted) RK is stored alongside the ciphertext in localStorage.
//
//   localStorage layout per entry:
//     { wrappedKey, wrappingIv, iv, ct, t }
//     wrappedKey  — AES-GCM ciphertext of the 32-byte RK (encrypted by MWK)
//     wrappingIv  — 12-byte IV used for the MWK→RK wrapKey operation
//     iv          — 12-byte IV used by the RK to encrypt the JSON payload
//     ct          — AES-GCM ciphertext of the JSON payload
//     t           — timestamp (for auditing / key rotation)
//
//   Attack surface vs. old approach (sessionStorage base64 key):
//     OLD: XSS reads sessionStorage → has the raw wrapping key → decrypts everything
//     NEW: XSS can call wrapKey/unwrapKey on the CryptoKey but cannot EXPORT the bytes,
//          so it cannot exfiltrate the wrapping key to a remote server.
// ============================================

import { encrypt, decrypt, toB64, fromB64 } from './primitives';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_PREFIX  = 'vanish_';
const IDENTITY_KEY    = 'identity_key';
const RATCHET_PREFIX  = 'ratchet_';
const SPK_PREFIX      = 'spk_';
const OPK_PREFIX      = 'opk_';
const IDB_DB_NAME     = 'VanishKeyStore';
const IDB_DB_VERSION  = 1;
const IDB_STORE_NAME  = 'wrapping_keys';
const IDB_KEY_ID      = 'master_wrapping_key';

// PBKDF2 parameters for password-based encryption
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_BYTES = 16;
const BACKUP_ALGORITHM = { name: 'AES-GCM', length: 256 };

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

/**
 * Open (or create) the VanishKeyStore IndexedDB database.
 * Creates the 'wrapping_keys' object store on first run.
 * @returns {Promise<IDBDatabase>}
 */
function openKeyStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Read a value from IndexedDB by id.
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<any|null>}
 */
function idbGet(db, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE_NAME, 'readonly');
    const req = tx.objectStore(IDB_STORE_NAME).get(id);
    req.onsuccess = (e) => resolve(e.target.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Write a value to IndexedDB (upsert by id).
 * IndexedDB can store CryptoKey objects directly via the structured clone algorithm —
 * no serialization required.
 * @param {IDBDatabase} db
 * @param {object} record — must include an 'id' field (keyPath)
 * @returns {Promise<void>}
 */
function idbPut(db, record) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE_NAME, 'readwrite');
    const req = tx.objectStore(IDB_STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Delete a record from IndexedDB by id.
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<void>}
 */
function idbDelete(db, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE_NAME, 'readwrite');
    const req = tx.objectStore(IDB_STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Master Wrapping Key (MWK) ─────────────────────────────────────────────────

/**
 * Get (or generate) the master wrapping key from IndexedDB.
 *
 * Key properties:
 *   algorithm : AES-GCM, 256-bit
 *   extractable: FALSE — raw key bytes are NEVER accessible to JS
 *   usages    : ['wrapKey', 'unwrapKey']
 *
 * The CryptoKey object is stored directly in IndexedDB via structured clone.
 * On subsequent calls, the same CryptoKey is returned — no round-trip through
 * base64 or any other serializable format.
 *
 * @returns {Promise<CryptoKey>}
 */
async function getWrappingKey() {
  const db = await openKeyStore();
  const record = await idbGet(db, IDB_KEY_ID);

  if (record?.cryptoKey) {
    return record.cryptoKey;
  }

  // First run — generate a non-extractable master wrapping key
  const cryptoKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,           // extractable = false: raw bytes are inaccessible to JS
    ['wrapKey', 'unwrapKey']
  );

  await idbPut(db, { id: IDB_KEY_ID, cryptoKey });
  return cryptoKey;
}

// ── Two-layer envelope encryption ─────────────────────────────────────────────

/**
 * Encrypt and store data using two-layer envelope encryption.
 *
 * Steps:
 *   1. Generate a fresh random 256-bit record key (RK) — extractable, for wrapping only
 *   2. Encrypt the JSON payload with RK using AES-GCM (via primitives.encrypt)
 *   3. Wrap (encrypt) the RK with the MWK using crypto.subtle.wrapKey
 *   4. Store { wrappedKey, wrappingIv, iv, ct, t } in localStorage
 *
 * @param {string} storageKey
 * @param {any}    data — JSON-serializable value
 */
async function secureStore(storageKey, data) {
  // Step 1: Generate a fresh per-record AES-GCM key (must be extractable for wrapKey)
  const recordCryptoKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,            // extractable = true, required by wrapKey
    ['encrypt', 'decrypt']
  );

  // Step 2: Encrypt the JSON payload with the record key
  // primitives.encrypt() expects a raw ArrayBuffer key, so we export first
  const recordKeyRaw = await crypto.subtle.exportKey('raw', recordCryptoKey);
  const json = JSON.stringify(data);
  const encrypted = await encrypt(recordKeyRaw, json);

  // Step 3: Wrap the record key with the non-extractable MWK
  const wrappingKey = await getWrappingKey();
  const wrappingIv  = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey  = await crypto.subtle.wrapKey(
    'raw',
    recordCryptoKey,
    wrappingKey,
    { name: 'AES-GCM', iv: wrappingIv }
  );

  // Step 4: Persist to localStorage
  const payload = {
    wrappedKey:  toB64(wrappedKey),
    wrappingIv:  toB64(wrappingIv),
    iv:          encrypted.iv,
    ct:          encrypted.ciphertext,
    t:           Date.now(),
  };
  localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(payload));
}

/**
 * Load and decrypt data using the reverse two-layer envelope.
 *
 * Steps:
 *   1. Load payload from localStorage
 *   2. Retrieve MWK from IndexedDB
 *   3. Unwrap the record key with MWK using crypto.subtle.unwrapKey
 *   4. Decrypt the JSON payload with the unwrapped record key
 *
 * @param {string} storageKey
 * @returns {Promise<any|null>}
 */
async function secureLoad(storageKey) {
  const stored = localStorage.getItem(STORAGE_PREFIX + storageKey);
  if (!stored) return null;

  try {
    const payload    = JSON.parse(stored);
    const wrappingKey = await getWrappingKey();

    // Unwrap the record key — result is a non-extractable AES-GCM decrypt key
    const unwrappedKey = await crypto.subtle.unwrapKey(
      'raw',
      fromB64(payload.wrappedKey),
      wrappingKey,
      { name: 'AES-GCM', iv: new Uint8Array(fromB64(payload.wrappingIv)) },
      { name: 'AES-GCM' },
      false,          // unwrapped key is non-extractable
      ['decrypt']
    );

    // Export the unwrapped key to raw bytes for primitives.decrypt()
    // Note: unwrapped with extractable=false above, so we re-do with extractable=true
    // for compatibility with primitives.decrypt(). Alternatively, use subtle.decrypt directly.
    // We use subtle.decrypt directly here to avoid the extractability requirement:
    const iv = new Uint8Array(fromB64(payload.iv));
    const ct = fromB64(payload.ct);
    const ptBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128, additionalData: new Uint8Array(0) },
      unwrappedKey,
      ct
    );
    return JSON.parse(new TextDecoder().decode(ptBuf));
  } catch {
    // Never log crypto errors in production — readable by extensions/error trackers
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save identity key pair (encrypted)
 * @param {{ publicB64: string, privateJwk: object }} keyPair
 */
export async function saveIdentityKey(keyPair) {
  await secureStore(IDENTITY_KEY, {
    publicB64:  keyPair.publicB64,
    privateJwk: keyPair.privateJwk,
  });
}

/**
 * Load identity key pair (decrypted)
 * @returns {Promise<{ publicB64: string, privateJwk: object }|null>}
 */
export async function loadIdentityKey() {
  return secureLoad(IDENTITY_KEY);
}

/**
 * Save a ratchet session for a conversation
 * @param {string} conversationId
 * @param {object} ratchetState — serialized ratchet state from DoubleRatchet.serialize()
 */
export async function saveRatchetSession(conversationId, ratchetState) {
  await secureStore(RATCHET_PREFIX + conversationId, ratchetState);
}

/**
 * Load a ratchet session for a conversation
 * @param {string} conversationId
 * @returns {Promise<object|null>}
 */
export async function loadRatchetSession(conversationId) {
  return secureLoad(RATCHET_PREFIX + conversationId);
}

/**
 * Check if a ratchet session exists in localStorage
 * @param {string} conversationId
 * @returns {Promise<boolean>}
 */
export async function hasRatchetSession(conversationId) {
  return localStorage.getItem(STORAGE_PREFIX + RATCHET_PREFIX + conversationId) !== null;
}

/**
 * Delete a ratchet session from localStorage
 * @param {string} conversationId
 */
export async function deleteRatchetSession(conversationId) {
  localStorage.removeItem(STORAGE_PREFIX + RATCHET_PREFIX + conversationId);
}

/**
 * Wipe ALL keys — called on logout.
 *
 * 1. Overwrites all Vanish localStorage entries with noise, then removes them
 * 2. Deletes the master wrapping key from IndexedDB — next init() generates a new MWK,
 *    making all previously wrapped record keys permanently unrecoverable
 *
 * Note: JS provides no guaranteed memory zeroing — the noise overwrite is best-effort
 * to reduce the window during which GC might return stale plaintext from heap memory.
 */
export async function wipeAllKeys() {
  // 1. Wipe all localStorage entries under our prefix
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => {
    try {
      // Overwrite with random noise before removing (best-effort memory scrub)
      const noise = crypto.getRandomValues(new Uint8Array(64));
      localStorage.setItem(key, toB64(noise.buffer));
    } catch { /* ignore write errors */ }
    localStorage.removeItem(key);
  });

  // 2. Delete the master wrapping key from IndexedDB
  // After this, all previously wrapped record keys are permanently unrecoverable.
  try {
    const db = await openKeyStore();
    await idbDelete(db, IDB_KEY_ID);
  } catch { /* non-fatal — localStorage data is already wiped */ }
}

/**
 * Check if an identity key exists in localStorage
 * @returns {Promise<boolean>}
 */
export async function hasIdentityKey() {
  return localStorage.getItem(STORAGE_PREFIX + IDENTITY_KEY) !== null;
}

// ── X3DH Prekey Storage ───────────────────────────────────────────────────────

/**
 * Save a Signed Pre-Key (SPK) private key to encrypted storage.
 *
 * @param {{ keyId: number, privateJwk: object, privateKey?: CryptoKey }} spk
 */
export async function saveSignedPreKey(spk) {
  await secureStore(SPK_PREFIX + spk.keyId, {
    keyId:      spk.keyId,
    privateJwk: spk.privateJwk,
    createdAt:  spk.createdAt || new Date().toISOString(),
  });
}

/**
 * Load a Signed Pre-Key private key from encrypted storage.
 *
 * Returns an object with a live CryptoKey privateKey, re-imported from the
 * stored JWK, ready for use in ECDH derivation.
 *
 * @param {number} keyId
 * @returns {Promise<{ keyId: number, privateKey: CryptoKey, privateJwk: object }|null>}
 */
export async function loadSignedPreKey(keyId) {
  const stored = await secureLoad(SPK_PREFIX + keyId);
  if (!stored?.privateJwk) return null;

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    stored.privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );

  return { keyId: stored.keyId, privateKey, privateJwk: stored.privateJwk };
}

/**
 * Load metadata for the current active Signed Pre-Key.
 * @returns {Promise<{ keyId: number, createdAt: string }|null>}
 */
export async function loadSignedPreKeyMeta() {
  // A simple strategy since we don't have an index: find the highest keyId
  // For production with many rotations, store the "active" ID in a dedicated key.
  // Here we just scan localStorage for the active one (highest ID).
  let latestKeyId = -1;
  let latestCreatedAt = null;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX + SPK_PREFIX)) {
      try {
        const payloadStr = localStorage.getItem(key);
        if (payloadStr) {
          // It's envelope encrypted, we have to decrypt to read metadata
          // Alternatively, we could just iterate backwards from a large number,
          // but let's just decrypt and find it.
          const localKey = key.substring(STORAGE_PREFIX.length);
          const decrypted = await secureLoad(localKey);
          if (decrypted && decrypted.keyId > latestKeyId) {
            // Check if it's not in grace period (we can add a 'graceExpiresAt' flag to check if needed)
            latestKeyId = decrypted.keyId;
            latestCreatedAt = decrypted.createdAt;
          }
        }
      } catch (e) {}
    }
  }
  
  if (latestKeyId === -1) return null;
  return { keyId: latestKeyId, createdAt: latestCreatedAt };
}

/**
 * Mark an old Signed Pre-Key as being in a grace period before deletion.
 * @param {number} keyId
 * @param {number} expiresAt - timestamp in ms
 */
export async function markSPKForGrace(keyId, expiresAt) {
  const stored = await secureLoad(SPK_PREFIX + keyId);
  if (stored) {
    stored.graceExpiresAt = expiresAt;
    await secureStore(SPK_PREFIX + keyId, stored);
  }
}

/**
 * Delete an expired Signed Pre-Key from storage.
 * @param {number} keyId 
 */
export async function deleteExpiredSPK(keyId) {
  const key = STORAGE_PREFIX + SPK_PREFIX + keyId;
  try {
    const noise = toB64(crypto.getRandomValues(new Uint8Array(64)).buffer);
    localStorage.setItem(key, noise);
  } catch {}
  localStorage.removeItem(key);
}

/**
 * Save an array of One-Time Pre-Keys (OPKs) to encrypted storage.
 * Each OPK is saved under its own storage key so individual keys
 * can be deleted after consumption.
 *
 * @param {Array<{ keyId: number, privateJwk: object }>} opks
 */
export async function saveOneTimePreKeys(opks) {
  await Promise.all(
    opks.map((opk) =>
      secureStore(OPK_PREFIX + opk.keyId, {
        keyId:      opk.keyId,
        privateJwk: opk.privateJwk,
      })
    )
  );
}

/**
 * Load a single One-Time Pre-Key by keyId from encrypted storage.
 *
 * @param {number} keyId
 * @returns {Promise<{ keyId: number, privateKey: CryptoKey, privateJwk: object }|null>}
 */
export async function loadOneTimePreKey(keyId) {
  const stored = await secureLoad(OPK_PREFIX + keyId);
  if (!stored?.privateJwk) return null;

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    stored.privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );

  const result = { keyId: stored.keyId, privateKey, privateJwk: stored.privateJwk };
  
  // Consume-once logic: delete immediately after successful read
  await deleteOneTimePreKey(keyId).catch(() => {});
  
  return result;
}

/**
 * Delete a One-Time Pre-Key from localStorage after it has been consumed.
 * Call this after x3dhRespond() to prevent OPK reuse.
 *
 * @param {number} keyId
 */
export async function deleteOneTimePreKey(keyId) {
  const key = STORAGE_PREFIX + OPK_PREFIX + keyId;
  // Overwrite with noise before removal (best-effort memory scrub)
  try {
    const noise = toB64(crypto.getRandomValues(new Uint8Array(64)).buffer);
    localStorage.setItem(key, noise);
  } catch { /* ignore */ }
  localStorage.removeItem(key);
}

/**
 * Returns the next available One-Time Pre-Key ID by incrementing a persistent counter.
 * Uses IndexedDB for secure storage.
 * @returns {Promise<number>}
 */
export async function getNextOPKId() {
  const db = await openKeyStore();
  const COUNTER_ID = 'opk_counter';
  
  let current = await idbGet(db, COUNTER_ID);
  const nextId = (current?.value || 0) + 1;
  
  await idbPut(db, { id: COUNTER_ID, value: nextId });
  return nextId;
}

// ── Password-Based Key Derivation ─────────────────────────────────────────────────

/**
 * Derive an encryption key from a password using PBKDF2.
 * @param {string} password - User password
 * @param {Uint8Array} salt - Salt bytes
 * @returns {Promise<CryptoKey>}
 */
async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  
  return crypto.subtle.importKey(
    'raw',
    bits,
    BACKUP_ALGORITHM,
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate random salt for PBKDF2.
 * @returns {Uint8Array}
 */
function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
}

// ── Encrypted Backup/Export ────────────────────────────────────────────────────

/**
 * Export all keys to an encrypted backup file.
 * Requires password for protection.
 * 
 * @param {string} password - Password to protect backup
 * @returns {Promise<{salt: string, iv: string, ciphertext: string}>}
 */
export async function exportKeyBackup(password) {
  // Collect all key data
  const backupData = {
    version: 1,
    exportedAt: Date.now(),
    identityKey: await loadIdentityKey(),
    spkKeys: [],
    opkKeys: [],
    ratchetSessions: []
  };
  
  // Find all SPK keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX + SPK_PREFIX)) {
      try {
        const localKey = key.substring(STORAGE_PREFIX.length);
        const data = await secureLoad(localKey);
        if (data) backupData.spkKeys.push(data);
      } catch {}
    }
  }
  
  // Find all OPK keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX + OPK_PREFIX)) {
      try {
        const localKey = key.substring(STORAGE_PREFIX.length);
        const data = await secureLoad(localKey);
        if (data) backupData.opkKeys.push(data);
      } catch {}
    }
  }
  
  // Find all ratchet sessions
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX + RATCHET_PREFIX)) {
      try {
        const convId = key.replace(STORAGE_PREFIX + RATCHET_PREFIX, '');
        const data = await loadRatchetSession(convId);
        if (data) backupData.ratchetSessions.push({ conversationId: convId, state: data });
      } catch {}
    }
  }
  
  // Encrypt with password-derived key
  const salt = generateSalt();
  const passwordKey = await deriveKeyFromPassword(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const json = JSON.stringify(backupData);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    passwordKey,
    new TextEncoder().encode(json)
  );
  
  return {
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext)
  };
}

/**
 * Import keys from an encrypted backup file.
 * Requires password used during export.
 * 
 * @param {string} password - Password used during export
 * @param {{salt: string, iv: string, ciphertext: string}} backup
 * @returns {Promise<boolean>}
 */
export async function importKeyBackup(password, backup) {
  try {
    const salt = new Uint8Array(fromB64(backup.salt));
    const iv = new Uint8Array(fromB64(backup.iv));
    const ct = fromB64(backup.ciphertext);
    
    const passwordKey = await deriveKeyFromPassword(password, salt);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      passwordKey,
      ct
    );
    
    const backupData = JSON.parse(new TextDecoder().decode(decrypted));
    
    // Check version
    if (backupData.version !== 1) {
      throw new Error('Unsupported backup version');
    }
    
    // Restore identity key
    if (backupData.identityKey) {
      await saveIdentityKey(backupData.identityKey);
    }
    
    // Restore SPK keys
    for (const spk of backupData.spkKeys || []) {
      await saveSignedPreKey(spk);
    }
    
    // Restore OPK keys
    for (const opk of backupData.opkKeys || []) {
      await secureStore(OPK_PREFIX + opk.keyId, opk);
    }
    
    // Restore ratchet sessions
    for (const session of backupData.ratchetSessions || []) {
      await saveRatchetSession(session.conversationId, session.state);
    }
    
    return true;
  } catch {
    throw new Error('Failed to import backup - wrong password or corrupted data');
  }
}

/**
 * Check if a backup can be decrypted with given password.
 * Does NOT restore anything, just validates.
 * 
 * @param {string} password - Password to test
 * @param {object} backup - Backup object
 * @returns {Promise<boolean>}
 */
export async function validateBackupPassword(password, backup) {
  try {
    const salt = new Uint8Array(fromB64(backup.salt));
    const iv = new Uint8Array(fromB64(backup.iv));
    const ct = fromB64(backup.ciphertext);
    
    const passwordKey = await deriveKeyFromPassword(password, salt);
    
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      passwordKey,
      ct
    );
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Get backup as downloadable file blob.
 * 
 * @param {string} password - Password for encryption
 * @returns {Promise<Blob>}
 */
export async function downloadKeyBackup(password) {
  const backup = await exportKeyBackup(password);
  const json = JSON.stringify(backup, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/**
 * Import from a File object.
 * 
 * @param {File} file - Backup file
 * @param {string} password - Password
 * @returns {Promise<boolean>}
 */
export async function importBackupFromFile(file, password) {
  const text = await file.text();
  const backup = JSON.parse(text);
  return importKeyBackup(password, backup);
}
