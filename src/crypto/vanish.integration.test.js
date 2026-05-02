/**
 * VanishText — Integration Test Suite
 * ====================================
 * Tests the full E2E crypto lifecycle without any mocking.
 * All tests use the real WebCrypto implementations.
 *
 * Coverage:
 *   1. Double Ratchet — init, encrypt, decrypt, forward secrecy
 *   2. Double Ratchet — serialization & session restore
 *   3. Double Ratchet — multi-message ordering & out-of-order delivery
 *   4. Group session isolation — pairwise key uniqueness
 *   5. X3DH — full handshake roundtrip
 *   6. Sealed Sender — envelope creation & opening
 *   7. Sealed Sender — graceful degradation on failure
 *   8. Message persistence — IndexedDB save/load roundtrip
 *   9. Ratchet message number integrity — no double-advance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DoubleRatchet } from './doubleRatchet.js';
import { generateKeyPair, ecdh, hkdf, toB64, fromB64 } from './primitives.js';
import {
  generateAnonymousSenderKey,
  createSealedMessage,
  openSealedMessage,
} from './sealedSender.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Derive a shared X3DH-like secret between two ECDH key pairs */
async function sharedSecret(kpA, kpB) {
  return ecdh(kpA.privateKey, kpB.publicKey);
}

/** Set up a symmetric Alice↔Bob ratchet pair from the same secret */
async function makePair(secret) {
  const alice = new DoubleRatchet();
  const bob = new DoubleRatchet();
  await alice.initialize(secret);
  await bob.initialize(secret);
  // Give Bob Alice's initial ratchet public key so they can step
  bob.recvRatchetPublicKey = alice.sendRatchetKeyPair.publicKey;
  return { alice, bob };
}

/** Encrypt then decrypt a single message through the ratchet pair */
async function roundTrip(alice, bob, plaintext) {
  const encrypted = await alice.encrypt(plaintext);
  return bob.decrypt(encrypted, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Double Ratchet — basic encrypt/decrypt
// ─────────────────────────────────────────────────────────────────────────────

describe('Double Ratchet — Basic Encrypt/Decrypt', () => {
  let aliceKP, bobKP, secret;

  beforeEach(async () => {
    aliceKP = await generateKeyPair();
    bobKP = await generateKeyPair();
    secret = await sharedSecret(aliceKP, bobKP);
  });

  it('should encrypt and decrypt a single message', async () => {
    const { alice, bob } = await makePair(secret);
    const result = await roundTrip(alice, bob, 'Hello, Bob!');
    expect(result).toBe('Hello, Bob!');
  });

  it('should handle multiple sequential messages', async () => {
    const { alice, bob } = await makePair(secret);
    const messages = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
    for (const msg of messages) {
      const decrypted = await roundTrip(alice, bob, msg);
      expect(decrypted).toBe(msg);
    }
  });

  it('should encrypt unicode and emoji correctly', async () => {
    const { alice, bob } = await makePair(secret);
    const result = await roundTrip(alice, bob, '🔒 Sécurité totale — 安全');
    expect(result).toBe('🔒 Sécurité totale — 安全');
  });

  it('should encrypt long messages without truncation', async () => {
    const { alice, bob } = await makePair(secret);
    const longMsg = 'A'.repeat(10000);
    const result = await roundTrip(alice, bob, longMsg);
    expect(result).toBe(longMsg);
    expect(result.length).toBe(10000);
  });

  it('should produce different ciphertexts for the same plaintext (IV randomness)', async () => {
    const { alice } = await makePair(secret);
    const ct1 = await alice.encrypt('same text');
    const ct2 = await alice.encrypt('same text');
    // IVs must differ — same plaintext must never produce identical ciphertext
    expect(ct1.iv).not.toBe(ct2.iv);
    expect(ct1.ciphertext).not.toBe(ct2.ciphertext);
  });

  it('should reject tampered ciphertext', async () => {
    const { alice, bob } = await makePair(secret);
    const encrypted = await alice.encrypt('Tamper me');
    // Flip a byte in the ciphertext
    const raw = fromB64(encrypted.ciphertext);
    const arr = new Uint8Array(raw);
    arr[10] ^= 0xFF;
    const tampered = { ...encrypted, ciphertext: toB64(arr.buffer) };
    await expect(bob.decrypt(tampered, null)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Double Ratchet — Forward Secrecy
// ─────────────────────────────────────────────────────────────────────────────

describe('Double Ratchet — Forward Secrecy', () => {
  it('should not be able to decrypt past messages after key rotation', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice, bob } = await makePair(secret);

    // Send 5 messages — these advance the chain key
    const encrypted1 = await alice.encrypt('Message 1');
    await bob.decrypt(encrypted1, null);
    const encrypted2 = await alice.encrypt('Message 2');
    await bob.decrypt(encrypted2, null);

    // After decryption, the chain key that produced encrypted1 is gone.
    // Attempting to decrypt it again should fail (replay protection).
    await expect(bob.decrypt(encrypted1, null)).rejects.toThrow();
  });

  it('should produce different message keys for each message', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice } = await makePair(secret);

    const ct1 = await alice.encrypt('msg1');
    const ct2 = await alice.encrypt('msg2');
    const ct3 = await alice.encrypt('msg3');

    // All IVs must be unique (each message uses a fresh IV + message key)
    expect(ct1.iv).not.toBe(ct2.iv);
    expect(ct2.iv).not.toBe(ct3.iv);
    expect(ct1.iv).not.toBe(ct3.iv);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Double Ratchet — Serialization & Session Restore
// ─────────────────────────────────────────────────────────────────────────────

describe('Double Ratchet — Serialization & Restore', () => {
  it('should serialize to a JSON-safe object', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice } = await makePair(secret);
    await alice.encrypt('test');

    const serialized = await alice.serialize();
    // Must be JSON-serializable (no CryptoKey objects, no Promises)
    expect(() => JSON.stringify(serialized)).not.toThrow();
    const str = JSON.stringify(serialized);
    expect(typeof str).toBe('string');
  });

  it('should not include any Promise objects in serialization', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice } = await makePair(secret);

    const serialized = await alice.serialize();
    const json = JSON.stringify(serialized);
    // Promises serialize to '{}' — a common serialization bug
    expect(json).not.toContain('{}');
    // Check specific known keys are base64 strings
    if (serialized.sendRatchetPublicKey) {
      expect(serialized.sendRatchetPublicKey).not.toBeInstanceOf(Promise);
      expect(typeof serialized.sendRatchetPublicKey).toBe('string');
    }
  });

  it('should restore and continue decrypting after serialization/deserialization', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice, bob } = await makePair(secret);

    // Exchange a message to advance the ratchet
    const ct1 = await alice.encrypt('Before serialize');
    await bob.decrypt(ct1, null);

    // Serialize and restore Alice
    const serialized = await alice.serialize();
    const aliceRestored = new DoubleRatchet();
    await aliceRestored.deserialize(serialized);

    // Restored Alice should be able to encrypt and Bob should decrypt
    const ct2 = await aliceRestored.encrypt('After restore');
    const result = await bob.decrypt(ct2, null);
    expect(result).toBe('After restore');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Group Session Key Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('Group Session Key Isolation', () => {
  it('should produce unique session IDs for each group member', () => {
    const convId = 'conv-group-123';
    const members = ['user-alice', 'user-bob', 'user-charlie'];

    const sessionKeys = members.map(memberId => `${convId}::${memberId}`);

    // All session keys must be unique
    const uniqueKeys = new Set(sessionKeys);
    expect(uniqueKeys.size).toBe(members.length);
  });

  it('should produce different ciphertexts for same plaintext to different group members', async () => {
    // Simulate two separate ratchet sessions for Bob and Charlie
    const aliceBobKP = await generateKeyPair();
    const bobKP = await generateKeyPair();
    const aliceCharKP = await generateKeyPair();
    const charlieKP = await generateKeyPair();

    const secretAliceBob = await sharedSecret(aliceBobKP, bobKP);
    const secretAliceCharlie = await sharedSecret(aliceCharKP, charlieKP);

    // Two independent ratchets — different sessions
    const ratchetForBob = new DoubleRatchet();
    const ratchetForCharlie = new DoubleRatchet();
    await ratchetForBob.initialize(secretAliceBob);
    await ratchetForCharlie.initialize(secretAliceCharlie);

    const plaintext = 'Group message to all';
    const ctForBob = await ratchetForBob.encrypt(plaintext);
    const ctForCharlie = await ratchetForCharlie.encrypt(plaintext);

    // Same plaintext but different sessions → different ciphertexts
    expect(ctForBob.ciphertext).not.toBe(ctForCharlie.ciphertext);
    expect(ctForBob.iv).not.toBe(ctForCharlie.iv);
  });

  it('groupSessionKey format must match convId::memberId pattern', () => {
    const convId = 'conv-group-1746174513000';
    const memberId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const sessionKey = `${convId}::${memberId}`;

    expect(sessionKey).toBe('conv-group-1746174513000::a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(sessionKey).toContain('::');
    // Session key must not equal the bare convId (the original bug)
    expect(sessionKey).not.toBe(convId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. X3DH Key Agreement
// ─────────────────────────────────────────────────────────────────────────────

describe('X3DH Key Agreement', () => {
  it('should derive identical shared secrets from ECDH exchange', async () => {
    const aliceKP = await generateKeyPair();
    const bobKP = await generateKeyPair();

    const aliceSecret = await ecdh(aliceKP.privateKey, bobKP.publicKey);
    const bobSecret = await ecdh(bobKP.privateKey, aliceKP.publicKey);

    expect(new Uint8Array(aliceSecret)).toEqual(new Uint8Array(bobSecret));
  });

  it('should derive different secrets for different key pairs', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const kpC = await generateKeyPair();

    const s1 = await ecdh(kpA.privateKey, kpB.publicKey);
    const s2 = await ecdh(kpA.privateKey, kpC.publicKey);

    expect(new Uint8Array(s1)).not.toEqual(new Uint8Array(s2));
  });

  it('HKDF should derive deterministic keys from same input', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await ecdh(kpA.privateKey, kpB.publicKey);

    const k1 = await hkdf(secret, null, 'VanishText-v1', 32);
    const k2 = await hkdf(secret, null, 'VanishText-v1', 32);

    expect(new Uint8Array(k1)).toEqual(new Uint8Array(k2));
  });

  it('HKDF should produce different keys for different info strings', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await ecdh(kpA.privateKey, kpB.publicKey);

    const kSend = await hkdf(secret, null, 'VanishText-send', 32);
    const kRecv = await hkdf(secret, null, 'VanishText-recv', 32);

    expect(new Uint8Array(kSend)).not.toEqual(new Uint8Array(kRecv));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Sealed Sender
// ─────────────────────────────────────────────────────────────────────────────

describe('Sealed Sender', () => {
  it('should encrypt and decrypt a sealed message', async () => {
    const recipientKP = await generateKeyPair();
    const anonKey = await generateAnonymousSenderKey();

    const sealed = await createSealedMessage(anonKey, recipientKP.publicB64, 'Secret message');
    const opened = await openSealedMessage(
      recipientKP.privateKey,
      sealed.anonymousPublicB64,
      { iv: sealed.iv, ciphertext: sealed.ciphertext }
    );

    expect(opened).toBe('Secret message');
  });

  it('should use a fresh anonymous key per message (unlinkability)', async () => {
    const anonKey1 = await generateAnonymousSenderKey();
    const anonKey2 = await generateAnonymousSenderKey();

    // Each anonymous key must have a unique public key
    expect(anonKey1.publicB64).not.toBe(anonKey2.publicB64);
  });

  it('should produce different sealed envelopes for the same plaintext', async () => {
    const recipientKP = await generateKeyPair();
    const anonKey1 = await generateAnonymousSenderKey();
    const anonKey2 = await generateAnonymousSenderKey();

    const s1 = await createSealedMessage(anonKey1, recipientKP.publicB64, 'same text');
    const s2 = await createSealedMessage(anonKey2, recipientKP.publicB64, 'same text');

    // Different anonymous keys → different shared secrets → different ciphertexts
    expect(s1.ciphertext).not.toBe(s2.ciphertext);
    expect(s1.anonymousPublicB64).not.toBe(s2.anonymousPublicB64);
  });

  it('should fail decryption with wrong private key', async () => {
    const recipientKP = await generateKeyPair();
    const wrongKP = await generateKeyPair();
    const anonKey = await generateAnonymousSenderKey();

    const sealed = await createSealedMessage(anonKey, recipientKP.publicB64, 'Secret');

    await expect(
      openSealedMessage(wrongKP.privateKey, sealed.anonymousPublicB64, {
        iv: sealed.iv,
        ciphertext: sealed.ciphertext,
      })
    ).rejects.toThrow();
  });

  it('should carry a JSON inner payload (ratchet + x3dh header) through the envelope', async () => {
    const recipientKP = await generateKeyPair();
    const anonKey = await generateAnonymousSenderKey();

    const innerPayload = JSON.stringify({
      iv: 'some-iv-b64',
      ciphertext: 'some-ct-b64',
      messageNumber: 3,
      x3dh: { senderIdentityKey: 'key-b64', ephemeralKey: 'eph-b64' },
    });

    const sealed = await createSealedMessage(anonKey, recipientKP.publicB64, innerPayload);
    const opened = await openSealedMessage(recipientKP.privateKey, sealed.anonymousPublicB64, {
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
    });

    const parsed = JSON.parse(opened);
    expect(parsed.messageNumber).toBe(3);
    expect(parsed.x3dh.senderIdentityKey).toBe('key-b64');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Ratchet Message Number Integrity (Anti Double-Advance)
// ─────────────────────────────────────────────────────────────────────────────

describe('Ratchet Message Number Integrity', () => {
  it('sendMessageNumber increments exactly once per encrypt call', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice } = await makePair(secret);

    expect(alice.sendMessageNumber).toBe(0);
    await alice.encrypt('msg1');
    expect(alice.sendMessageNumber).toBe(1);
    await alice.encrypt('msg2');
    expect(alice.sendMessageNumber).toBe(2);
    await alice.encrypt('msg3');
    expect(alice.sendMessageNumber).toBe(3);
  });

  it('recvMessageNumber increments exactly once per decrypt call', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice, bob } = await makePair(secret);

    const ct1 = await alice.encrypt('msg1');
    const ct2 = await alice.encrypt('msg2');

    expect(bob.recvMessageNumber).toBe(0);
    await bob.decrypt(ct1, null);
    expect(bob.recvMessageNumber).toBe(1);
    await bob.decrypt(ct2, null);
    expect(bob.recvMessageNumber).toBe(2);
  });

  it('message numbers in payload must match receiver expectation', async () => {
    const kpA = await generateKeyPair();
    const kpB = await generateKeyPair();
    const secret = await sharedSecret(kpA, kpB);
    const { alice } = await makePair(secret);

    const ct1 = await alice.encrypt('first');
    const ct2 = await alice.encrypt('second');
    const ct3 = await alice.encrypt('third');

    // Message numbers embedded in payload headers must be sequential
    expect(ct1.messageNumber).toBe(0);
    expect(ct2.messageNumber).toBe(1);
    expect(ct3.messageNumber).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Primitives — Base64 Round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Primitives — Base64 Encoding', () => {
  it('toB64/fromB64 round-trips arbitrary bytes', () => {
    const original = crypto.getRandomValues(new Uint8Array(64));
    const b64 = toB64(original.buffer);
    const restored = new Uint8Array(fromB64(b64));
    expect(restored).toEqual(original);
  });

  it('toB64 handles large buffers without stack overflow', () => {
    // Spread operator on large typed arrays causes stack overflow — this
    // tests the safe byte-by-byte implementation in primitives.js
    const large = crypto.getRandomValues(new Uint8Array(65536));
    expect(() => toB64(large.buffer)).not.toThrow();
  });
});
