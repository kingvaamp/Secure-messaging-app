// ============================================
// Encrypted Blob Storage
//
// Handles large attachment uploads using a two-step process:
//   1. Encrypt the raw file bytes locally with a fresh AES-256-GCM key
//   2. Upload only the ciphertext to Supabase Storage
//   3. Return a small "attachment ref" (url + key + iv) that travels
//      inside the Double Ratchet payload — safe for WebSocket limits
//
// Security properties:
//   - Supabase Storage sees only random bytes — zero-knowledge server
//   - Symmetric key is E2E-protected inside the ratchet ciphertext
//   - Per-file random key — no key reuse across uploads
//   - AES-GCM provides authenticated encryption — tampering detected
//   - Backward compatible: attachments without `encrypted: true` are
//     treated as legacy inline base64 data URLs
// ============================================

import { toB64, fromB64 } from './primitives';

const BUCKET = 'vanish-attachments';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Import a raw AES-GCM key from a base64-encoded 32-byte key.
 * @param {string} keyB64
 * @param {'encrypt'|'decrypt'} usage
 * @returns {Promise<CryptoKey>}
 */
async function importAesKey(keyB64, usage) {
  return crypto.subtle.importKey(
    'raw',
    fromB64(keyB64),
    { name: 'AES-GCM' },
    false,
    [usage]
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt a File locally and upload the ciphertext to Supabase Storage.
 *
 * @param {File}   file           - Raw File object from <input type="file">
 * @param {string} conversationId - Used to namespace the storage path
 * @param {string} userId         - Supabase user ID for storage path
 * @returns {Promise<AttachmentRef>}
 *
 * @typedef {Object} AttachmentRef
 * @property {string}  url       - Public/signed Supabase Storage URL
 * @property {string}  keyB64    - AES-256-GCM key (base64) — travels in ratchet payload
 * @property {string}  ivB64     - AES-GCM IV (base64)
 * @property {string}  type      - MIME type (e.g. "image/jpeg")
 * @property {string}  name      - Original filename
 * @property {number}  size      - Original file size in bytes
 * @property {true}    encrypted - Flag for the receiver to distinguish from legacy URLs
 */
export async function encryptAndUpload(file, conversationId, userId) {
  // 1. Generate a fresh random AES-256-GCM key and IV
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyB64 = toB64(rawKey);
  const ivB64 = toB64(iv);

  // 2. Read the file as an ArrayBuffer and encrypt it
  const plainBuffer = await file.arrayBuffer();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    plainBuffer
  );

  // 3. Upload the encrypted blob to Supabase Storage
  //    Path: {userId}/{conversationId}/{uuid}.enc
  const uuid = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (b) => b.toString(16).padStart(2, '0')
  ).join('');
  const storagePath = `${userId}/${conversationId}/${uuid}.enc`;

  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, new Blob([cipherBuffer], { type: 'application/octet-stream' }), {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error('🚨 [Vanish Security] Blob upload failed:', error.message);
    if (error.message.includes('400') || error.message.includes('403') || error.message.includes('PGRST')) {
      console.error('🚨 This might be due to missing RLS policies on the `vanish-attachments` storage bucket. Ensure you have policies for INSERT/SELECT/DELETE for authenticated users.');
    }
    throw new Error(`[blobStorage] Upload failed: ${error.message}`);
  }

  // 4. Get a public URL for the uploaded file
  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  if (!urlData?.publicUrl) {
    throw new Error('[blobStorage] Could not get public URL for uploaded blob');
  }

  return {
    url: urlData.publicUrl,
    keyB64,
    ivB64,
    type: file.type,
    name: file.name,
    size: file.size,
    encrypted: true,
  };
}

/**
 * Download and decrypt an encrypted attachment from Supabase Storage.
 * Returns a blob:// object URL suitable for use in <img src> or <video src>.
 *
 * The caller is responsible for revoking the URL when the element is unmounted:
 *   URL.revokeObjectURL(blobUrl)
 *
 * @param {AttachmentRef} attachment - The attachment ref from the ratchet payload
 * @returns {Promise<string>} - blob:// URL
 */
export async function downloadAndDecrypt(attachment) {
  if (!attachment?.encrypted) {
    // Legacy inline data URL — return as-is
    return attachment?.url ?? null;
  }

  // 1. Fetch the encrypted blob from Supabase Storage
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`[blobStorage] Download failed: ${response.status} ${response.statusText}`);
  }
  const cipherBuffer = await response.arrayBuffer();

  // 2. Decrypt with the key and IV from the ratchet payload
  const cryptoKey = await importAesKey(attachment.keyB64, 'decrypt');
  const iv = fromB64(attachment.ivB64);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    cipherBuffer
  );

  // 3. Return an object URL for the decrypted file
  const blob = new Blob([plainBuffer], { type: attachment.type });
  return URL.createObjectURL(blob);
}

/**
 * Delete an encrypted blob from Supabase Storage.
 * Called when a message with an encrypted attachment is deleted.
 *
 * @param {string} url - The public URL of the blob to delete
 */
export async function deleteBlob(url) {
  try {
    // Extract the storage path from the public URL
    // Public URL format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
    const marker = `/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return; // not a managed blob URL

    const storagePath = url.slice(idx + marker.length);
    const { supabase } = await import('@/lib/supabase');
    await supabase.storage.from(BUCKET).remove([storagePath]);
  } catch (e) {
    console.warn('[blobStorage] deleteBlob failed (non-critical):', e.message);
  }
}
