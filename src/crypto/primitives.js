// ============================================
// WebCrypto Primitives — ECDH P-256 + AES-256-GCM + HKDF + HMAC
// ============================================

/**
 * Safe base64 encoding — NO spread operator (anti stack overflow)
 * Iterates byte-by-byte for buffers of any size
 */
export const toB64 = (buf) => {
  let bin = '';
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

/**
 * Safe base64 decoding — converts base64 string back to ArrayBuffer
 */
export const fromB64 = (str) =>
  Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer;

/**
 * Generate a new ECDH P-256 key pair
 * Returns: { publicKey, privateKey, publicB64, privateJwk }
 */
export async function generateKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
  const publicRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicB64: toB64(publicRaw),
    privateJwk,
  };
}

/**
 * Import a public key from base64-encoded raw ECDH P-256 key
 */
export async function importPublicKey(b64) {
  return crypto.subtle.importKey(
    'raw',
    fromB64(b64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Import a private key from JWK format
 */
export async function importPrivateKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // not extractable
    ['deriveKey', 'deriveBits']
  );
}

/**
 * ECDH key agreement — derive shared secret
 */
export async function ecdh(privateKey, publicKey) {
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
}

/**
 * HKDF-SHA256 key derivation
 * @param {ArrayBuffer} ikm — input keying material
 * @param {ArrayBuffer|null} salt — optional salt
 * @param {string} info — context info string
 * @param {number} bytes — output length in bytes (default 32)
 */
export async function hkdf(ikm, salt, info, bytes = 32) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt || new Uint8Array(32),
      info: new TextEncoder().encode(info),
    },
    key,
    bytes * 8
  );
}

/**
 * HMAC-SHA256 signature
 */
export async function hmac(keyBuf, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, data);
}

/**
 * AES-256-GCM encryption
 * Returns: { iv: base64, ciphertext: base64 }
 */
export async function encrypt(keyBuf, plaintext) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    'AES-GCM',
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

/**
 * AES-256-GCM decryption
 */
export async function decrypt(keyBuf, ivB64, ctB64) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    'AES-GCM',
    false,
    ['decrypt']
  );
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64), tagLength: 128 },
    key,
    fromB64(ctB64)
  );
  return new TextDecoder().decode(pt);
}

/**
 * Constant-time comparison of two ArrayBuffers
 * Prevents timing attacks on MAC verification
 */
export function constantTimeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) {
    diff |= ua[i] ^ ub[i];
  }
  return diff === 0;
}
