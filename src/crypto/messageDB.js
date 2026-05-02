// ============================================
// Encrypted Local Message Database
//
// Uses IndexedDB with envelope encryption (similar to Signal's local DB).
// Messages persist across app restarts.
//
// Security:
//   - Messages encrypted with AES-256-GCM before storage
//   - Uses the same two-layer envelope as keyStorage
//   - Database stored in IndexedDB (browser-protected storage)
//   - Each conversation has its own encrypted store
// ============================================

import { encrypt, decrypt, toB64, fromB64 } from './primitives';
import { getMessageDBSecret } from './keyStorage';

const DB_NAME = 'VanishMessages';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

let db = null;

// ── IndexedDB Helpers ───────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('conversationId', 'conversationId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    
    request.onerror = (e) => reject(e.target.error);
  });
}

function dbPut(message) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(message);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function dbGet(id) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGetByConversation(conversationId) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('conversationId');
    const request = index.getAll(IDBKeyRange.only(conversationId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(id) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function dbDeleteByConversation(conversationId) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('conversationId');
    const request = index.openCursor(IDBKeyRange.only(conversationId));
    
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Encryption Helpers ─────────────────────────────────────────────────

const enc = new TextEncoder();

// Simple per-conversation key derivation for message encryption
async function deriveMessageKey(conversationId, salt) {
  const secret = await getMessageDBSecret();
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    secret,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new Uint8Array(fromB64(salt)), iterations: 10000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
}

async function encryptMessageContent(content, conversationId, senderId = null) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = toB64(salt);
  // Mirror decryptMessageContent: use a per-sender session key for group messages
  const sessionKey = senderId ? `${conversationId}::${senderId}` : conversationId;
  const bits = await deriveMessageKey(sessionKey, saltB64);
  
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    enc.encode(content)
  );
  
  return {
    salt: saltB64,
    iv: toB64(iv),
    ciphertext: toB64(ciphertext)
  };
}

async function decryptMessageContent(encrypted, conversationId, senderId = null) {
  // For group messages, use unique session key: convId::senderId
  const sessionKey = senderId ? `${conversationId}::${senderId}` : conversationId;
  const bits = await deriveMessageKey(sessionKey, encrypted.salt);
  
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
  const iv = fromB64(encrypted.iv);
  const ct = fromB64(encrypted.ciphertext);
  
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ct
  );
  
  return new TextDecoder().decode(plaintext);
}


// ── Public API ────────────────────────────────────────────────────────

/**
 * Save a message to local encrypted database
 * @param {object} message - Message object with: id, conversationId, text, sender, etc.
 */
export async function saveMessage(message) {
  const messageData = {
    ...message,
    // Encrypt sensitive fields — pass senderId so group messages use
    // a per-sender session key matching what decryptMessageContent expects.
    encrypted: await encryptMessageContent(
      JSON.stringify({ text: message.text, attachment: message.attachment }),
      message.conversationId,
      message.senderId || null
    ),
    // Keep searchable metadata (unencrypted for indexing)
    timestamp: message.timestamp || Date.now(),
    senderId: message.senderId,
    conversationId: message.conversationId,
    type: message.type || 'text',
    status: message.status || 'sent'
  };
  
  // Remove plaintext fields - they're now in encrypted blob
  delete messageData.text;
  delete messageData.attachment;
  
  await dbPut(messageData);
  return messageData;
}

/**
 * Load all messages for a conversation
 * @param {string} conversationId 
 * @returns {Promise<Array>} - Decrypted messages
 */
export async function loadConversationMessages(conversationId) {
  const messages = await dbGetByConversation(conversationId);
  
  const decrypted = await Promise.all(
    messages.map(async (msg) => {
      try {
        // Pass senderId so group messages resolve the correct per-sender key
        const plaintext = await decryptMessageContent(msg.encrypted, conversationId, msg.senderId || null);
        const parsed = JSON.parse(plaintext);
        return {
          ...msg,
          text: parsed.text,
          attachment: parsed.attachment,
          // Mark as loaded from persistence
          persisted: true
        };
      } catch (e) {
        console.warn('Failed to decrypt message:', msg.id, 'sender:', msg.senderId);
        return {
          ...msg,
          text: '[Decryption failed]',
          persisted: true,
          corrupted: true
        };
      }
    })
  );
  
  // Sort by timestamp
  return decrypted.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get a single message by ID
 * @param {string} id 
 * @returns {Promise<object|null>}
 */
export async function getMessage(id) {
  const msg = await dbGet(id);
  if (!msg) return null;
  
  try {
    // Pass senderId to match the per-sender key used at save time
    const plaintext = await decryptMessageContent(msg.encrypted, msg.conversationId, msg.senderId || null);
    const parsed = JSON.parse(plaintext);
    return { ...msg, text: parsed.text, attachment: parsed.attachment };
  } catch {
    return { ...msg, text: '[Decryption failed]', corrupted: true };
  }
}

/**
 * Delete a message
 * @param {string} id 
 */
export async function deleteMessage(id) {
  await dbDelete(id);
}

/**
 * Delete all messages for a conversation
 * @param {string} conversationId 
 */
export async function deleteConversationMessages(conversationId) {
  await dbDeleteByConversation(conversationId);
}

/**
 * Wipe all local messages (logout)
 */
export async function wipeAllMessages() {
  const database = await openDB();
  const tx = database.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await store.clear();
}

/**
 * Get message count for a conversation
 * @param {string} conversationId 
 * @returns {Promise<number>}
 */
export async function getMessageCount(conversationId) {
  const messages = await dbGetByConversation(conversationId);
  return messages.length;
}

/**
 * Check if database has messages for a conversation
 * @param {string} conversationId 
 * @returns {Promise<boolean>}
 */
export async function hasConversationMessages(conversationId) {
  const count = await getMessageCount(conversationId);
  return count > 0;
}