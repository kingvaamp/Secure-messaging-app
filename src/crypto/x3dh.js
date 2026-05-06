// ============================================
// X3DH — Extended Triple Diffie-Hellman Key Agreement
// Signal Protocol spec: https://signal.org/docs/specifications/x3dh/
//
// Enables asynchronous session establishment:
// Alice can send Bob a message while Bob is offline by consuming his
// pre-published prekeys. The resulting shared secret (SK) and associated
// data (AD) are fed into the Double Ratchet to establish the session.
//
// Key roles:
//   IK  — Long-term Identity Key      (ECDH P-256)
//   SPK — Signed Pre-Key              (ECDH P-256, signed with ECDSA identity key)
//   OPK — One-Time Pre-Key            (ECDH P-256, consumed once)
//   EK  — Ephemeral Key               (ECDH P-256, generated per message by Alice)
// ============================================

import { toB64, fromB64, hkdf, generateKeyPair } from './primitives';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Concatenate multiple Uint8Array / ArrayBuffer values into a single Uint8Array.
 */
function concat(...arrays) {
  const parts = arrays.map((a) => new Uint8Array(a instanceof ArrayBuffer ? a : a.buffer ?? a));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * ECDH deriveBits between privateKey and publicKey → 256-bit ArrayBuffer.
 */
async function dh(privateKey, publicKey) {
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
}

/**
 * Import a raw P-256 public key for ECDH (key_ops = []).
 */
async function importECDHPublic(rawOrB64) {
  const raw = typeof rawOrB64 === 'string' ? fromB64(rawOrB64) : rawOrB64;
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Import a raw P-256 public key for ECDSA verify (key_ops = ['verify']).
 */
async function importECDSAPublic(rawOrB64) {
  const raw = typeof rawOrB64 === 'string' ? fromB64(rawOrB64) : rawOrB64;
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

// ── 1. Identity Key Pair ──────────────────────────────────────────────────────

/**
 * Generate a combined identity key pair:
 *   - ECDSA P-256 key pair  (for signing prekeys)
 *   - ECDH P-256 key pair   (re-derived from the same JWK for key agreement)
 *
 * Keys are generated as non-extractable for security.
 * Only the public key and JWK for storage are exported.
 *
 * @returns {{ publicKeyECDH, privateKeyECDH, publicKeyECDSA, privateKeyECDSA, publicB64, privateJwk }}
 */
export async function generateIdentityKeyPair() {
  // Generate the ECDSA key pair (used for signing prekeys)
  // Generate extractable first, then we'll secure the private key
  const ecdsaKP = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // extractable for initial export
    ['sign', 'verify']
  );

  // Export the ECDSA private key as JWK so we can re-import as non-extractable ECDH
  const privateJwk = await crypto.subtle.exportKey('jwk', ecdsaKP.privateKey);
  const publicRaw   = await crypto.subtle.exportKey('raw', ecdsaKP.publicKey);

  // Create non-extractable ECDH private key from JWK
  const ecdhPrivJwk = { ...privateJwk, key_ops: ['deriveBits'], kty: 'EC', alg: undefined };
  delete ecdhPrivJwk.alg; // ECDH JWK must NOT have an alg field
  const privateKeyECDH = await crypto.subtle.importKey(
    'jwk',
    ecdhPrivJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // NOT extractable - security
    ['deriveBits']
  );

  // Non-extractable ECDH public key
  const publicKeyECDH = await importECDHPublic(publicRaw);

  return {
    publicKeyECDH,   // CryptoKey — ECDH, for DH computations (non-extractable)
    privateKeyECDH,  // CryptoKey — ECDH, for DH computations (non-extractable)
    publicKeyECDSA:  ecdsaKP.publicKey,   // CryptoKey — ECDSA, for signature verification
    privateKeyECDSA: ecdsaKP.privateKey,  // CryptoKey — ECDSA, for signing prekeys
    publicB64:  toB64(publicRaw),         // base64 raw bytes — published to key server
    privateJwk,                            // JWK — stored securely by owner
  };
}

// ── 2. Signed Pre-Key ─────────────────────────────────────────────────────────

/**
 * Generate a Signed Pre-Key (SPK) — an ECDH key pair whose public key is
 * signed with the identity ECDSA private key. Rotated periodically (weekly).
 *
 * @param {CryptoKey} identityPrivateKeyECDSA — ECDSA private key for signing
 * @param {number}    keyId                   — monotonically increasing ID
 * @returns {{ keyId, publicKey, privateKey, publicB64, privateJwk, signature }}
 */
export async function generateSignedPreKey(identityPrivateKeyECDSA, keyId) {
  const kp = await generateKeyPair(); // ECDH P-256

  // Sign the raw public key bytes with ECDSA SHA-256
  const publicRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identityPrivateKeyECDSA,
    publicRaw
  );

  return {
    keyId,
    publicKey:  kp.publicKey,
    privateKey: kp.privateKey,
    publicB64:  kp.publicB64,
    privateJwk: kp.privateJwk,
    signature:  toB64(sig), // base64-encoded ECDSA-SHA-256 signature
  };
}

// ── 3. One-Time Pre-Key ───────────────────────────────────────────────────────

/**
 * Generate a One-Time Pre-Key (OPK) — an ECDH key pair consumed exactly once.
 * A batch is uploaded to the key server; each is deleted after use.
 *
 * @param {number} keyId — unique ID within the OPK batch
 * @returns {{ keyId, publicKey, privateKey, publicB64, privateJwk }}
 */
export async function generateOneTimePreKey(keyId) {
  const kp = await generateKeyPair();
  return {
    keyId,
    publicKey:  kp.publicKey,
    privateKey: kp.privateKey,
    publicB64:  kp.publicB64,
    privateJwk: kp.privateJwk,
  };
}

// ── 4. X3DH Initiate (Alice → sends first message) ───────────────────────────

/**
 * Alice initiates an X3DH session using Bob's published key bundle.
 *
 * DH computations (Signal spec §2.3):
 *   DH1 = ECDH(IK_A_priv,  SPK_B_pub)   — Alice identity   × Bob signed prekey
 *   DH2 = ECDH(EK_A_priv,  IK_B_pub)    — Alice ephemeral  × Bob identity
 *   DH3 = ECDH(EK_A_priv,  SPK_B_pub)   — Alice ephemeral  × Bob signed prekey
 *   DH4 = ECDH(EK_A_priv,  OPK_B_pub)   — Alice ephemeral  × Bob one-time prekey [optional]
 *
 * SK  = HKDF(DH1 || DH2 || DH3 [|| DH4], info='VanishText-X3DH-v1') → 32 bytes
 * AD  = IK_A_pub_raw || IK_B_pub_raw
 *
 * @param {{ privateKeyECDH, publicKeyECDSA, publicB64 }} ourIdentityKey
 * @param {{ identityPublicB64, signedPreKey: { publicB64, signature }, oneTimePreKey?: { publicB64 } }} theirBundle
 * @returns {{ sk: ArrayBuffer, ad: Uint8Array, ephemeralPublicB64: string }}
 */
export async function x3dhInitiate(ourIdentityKey, theirBundle) {
  // ── Import their keys ──────────────────────────────────────────────────────
  const theirIdentityPublicRaw = new Uint8Array(fromB64(theirBundle.identityPublicB64));
  const theirIdentityECDH      = await importECDHPublic(theirIdentityPublicRaw);
  const theirIdentityECDSA     = await importECDSAPublic(theirIdentityPublicRaw);

  const theirSPKPublicRaw = new Uint8Array(fromB64(theirBundle.signedPreKey.publicB64));
  const theirSPKPublic    = await importECDHPublic(theirSPKPublicRaw);

  // ── Step a: Verify signed prekey signature ────────────────────────────────
  const sigBytes = fromB64(theirBundle.signedPreKey.signature);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    theirIdentityECDSA,
    sigBytes,
    theirSPKPublicRaw
  );
  if (!valid) {
    throw new Error('X3DH: signed prekey signature verification failed — bundle may be tampered');
  }

  // ── Step b: Generate Alice's ephemeral key pair ───────────────────────────
  const ek = await generateKeyPair();

  // ── Step c: Compute DH outputs ────────────────────────────────────────────
  const DH1 = await dh(ourIdentityKey.privateKeyECDH, theirSPKPublic);   // IK_A × SPK_B
  const DH2 = await dh(ek.privateKey,                  theirIdentityECDH); // EK_A × IK_B
  const DH3 = await dh(ek.privateKey,                  theirSPKPublic);   // EK_A × SPK_B

  const dhParts = [DH1, DH2, DH3];

  if (theirBundle.oneTimePreKey?.publicB64) {
    const theirOPK = await importECDHPublic(theirBundle.oneTimePreKey.publicB64);
    const DH4 = await dh(ek.privateKey, theirOPK);                        // EK_A × OPK_B
    dhParts.push(DH4);
  }

  // ── Step d: Derive shared key via HKDF ────────────────────────────────────
  const dhConcat = concat(...dhParts);
  const sk = await hkdf(dhConcat.buffer, null, 'VanishText-X3DH-v1', 32);

  // ── Step e: Associated data ───────────────────────────────────────────────
  const ourPublicRaw = new Uint8Array(fromB64(ourIdentityKey.publicB64));
  const ad = concat(ourPublicRaw, theirIdentityPublicRaw);

  return {
    sk,                           // ArrayBuffer — 32-byte session key → feed to DoubleRatchet
    ad,                           // Uint8Array  — AD for AEAD context
    ephemeralPublicB64: ek.publicB64, // string — sent to Bob in the initial message header
    ephemeralKeyPair: ek,         // full key pair — Alice reuses as her initial DH ratchet key
  };
}

// ── 5. X3DH Respond (Bob ← receives first message) ───────────────────────────

/**
 * Bob responds to Alice's X3DH initiation. Mirrors Alice's DH computations
 * by swapping key roles so both sides arrive at the same SK.
 *
 * DH computations (Signal spec §2.4):
 *   DH1 = ECDH(SPK_B_priv,  IK_A_pub)   — Bob signed prekey    × Alice identity
 *   DH2 = ECDH(IK_B_priv,   EK_A_pub)   — Bob identity         × Alice ephemeral
 *   DH3 = ECDH(SPK_B_priv,  EK_A_pub)   — Bob signed prekey    × Alice ephemeral
 *   DH4 = ECDH(OPK_B_priv,  EK_A_pub)   — Bob one-time prekey  × Alice ephemeral [optional]
 *
 * @param {{ privateKeyECDH, publicB64 }}  ourIdentityKey  — Bob's identity key
 * @param {{ privateKey, publicB64 }}      ourSignedPreKey — Bob's signed prekey (private)
 * @param {{ privateKey }|null}            ourOneTimePreKey — Bob's OPK (private), or null
 * @param {{ identityPublicB64, ephemeralPublicB64 }} theirBundle — Alice's header
 * @returns {{ sk: ArrayBuffer, ad: Uint8Array }}
 */
export async function x3dhRespond(ourIdentityKey, ourSignedPreKey, ourOneTimePreKey, theirBundle) {
  // ── Import Alice's public keys ─────────────────────────────────────────────
  const theirIdentityPublicRaw = new Uint8Array(fromB64(theirBundle.identityPublicB64));
  const theirIdentityECDH      = await importECDHPublic(theirIdentityPublicRaw);
  const theirEKPublic          = await importECDHPublic(theirBundle.ephemeralPublicB64);

  // ── Compute mirrored DH outputs ────────────────────────────────────────────
  const DH1 = await dh(ourSignedPreKey.privateKey,  theirIdentityECDH); // SPK_B × IK_A
  const DH2 = await dh(ourIdentityKey.privateKeyECDH, theirEKPublic);   // IK_B  × EK_A
  const DH3 = await dh(ourSignedPreKey.privateKey,  theirEKPublic);     // SPK_B × EK_A

  const dhParts = [DH1, DH2, DH3];

  if (ourOneTimePreKey?.privateKey) {
    const DH4 = await dh(ourOneTimePreKey.privateKey, theirEKPublic);   // OPK_B × EK_A
    dhParts.push(DH4);
  }

  // ── Derive shared key via HKDF ─────────────────────────────────────────────
  const dhConcat = concat(...dhParts);
  const sk = await hkdf(dhConcat.buffer, null, 'VanishText-X3DH-v1', 32);

  // ── Associated data ────────────────────────────────────────────────────────
  const ourPublicRaw = new Uint8Array(fromB64(ourIdentityKey.publicB64));
  const ad = concat(theirIdentityPublicRaw, ourPublicRaw); // Alice || Bob (same order as initiate)

  return { sk, ad };
}

// ── 6. Generate Full X3DH Bundle ─────────────────────────────────────────────

/**
 * Generate a complete X3DH prekey bundle for publishing to the key server.
 *
 * Returns:
 *   publicBundle — safe to upload to the key server (no private keys)
 *   privateKeys  — must be stored securely on-device only
 *
 * @param {{ privateKeyECDSA, publicB64 }} identityKeyPair      — user's identity key pair
 * @param {number}                          signedPreKeyId        — SPK key ID
 * @param {number}                          oneTimePreKeyCount    — number of OPKs to generate (default 20)
 * @returns {{ publicBundle, privateKeys }}
 */
export async function generateX3DHBundle(identityKeyPair, signedPreKeyId, oneTimePreKeyCount = 20) {
  // Generate signed prekey
  const spk = await generateSignedPreKey(identityKeyPair.privateKeyECDSA, signedPreKeyId);

  // Generate one-time prekeys
  const opkPromises = Array.from({ length: oneTimePreKeyCount }, (_, i) =>
    generateOneTimePreKey(i + 1)
  );
  const opks = await Promise.all(opkPromises);

  // Public bundle — safe for the key server (no private keys)
  const publicBundle = {
    identityKey: {
      publicB64: identityKeyPair.publicB64,
    },
    signedPreKey: {
      keyId:     spk.keyId,
      publicB64: spk.publicB64,
      signature: spk.signature,
    },
    oneTimePreKeys: opks.map((opk) => ({
      keyId:     opk.keyId,
      publicB64: opk.publicB64,
    })),
  };

  // Private keys — stored securely on-device only, NEVER uploaded
  const privateKeys = {
    signedPreKey: {
      keyId:      spk.keyId,
      privateKey: spk.privateKey,
      privateJwk: spk.privateJwk,
    },
    oneTimePreKeys: opks.map((opk) => ({
      keyId:      opk.keyId,
      privateKey: opk.privateKey,
      privateJwk: opk.privateJwk,
    })),
  };

  return { publicBundle, privateKeys };
}
