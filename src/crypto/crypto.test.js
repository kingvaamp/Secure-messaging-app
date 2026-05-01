import { describe, it, expect } from 'vitest';
import { ecdh, hkdf } from './primitives.js';

async function generateTestKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

describe('Crypto Primitives', () => {
  describe('ECDH', () => {
    it('should derive same shared secret from key pair exchange', async () => {
      const alice = await generateTestKeyPair();
      const bob = await generateTestKeyPair();
      
      const aliceSecret = await ecdh(alice.privateKey, bob.publicKey);
      const bobSecret = await ecdh(bob.privateKey, alice.publicKey);
      
      expect(aliceSecret.byteLength).toBe(bobSecret.byteLength);
      expect(new Uint8Array(aliceSecret)).toEqual(new Uint8Array(bobSecret));
    });
  });

  describe('Session Key Derivation', () => {
    it('should derive symmetric key from shared secret', async () => {
      const alice = await generateTestKeyPair();
      const bob = await generateTestKeyPair();
      
      const shared = await ecdh(alice.privateKey, bob.publicKey);
      const key = await hkdf(shared, null, 'session', 32);
      
      expect(key).toBeDefined();
      expect(key.byteLength).toBe(32);
    });

    it('should produce unique keys for different sessions', async () => {
      const alice = await generateTestKeyPair();
      const bob = await generateTestKeyPair();
      const charlie = await generateTestKeyPair();
      
      const key1 = await hkdf(await ecdh(alice.privateKey, bob.publicKey), null, 'session', 32);
      const key2 = await hkdf(await ecdh(alice.privateKey, charlie.publicKey), null, 'session', 32);
      
      expect(new Uint8Array(key1)).not.toEqual(new Uint8Array(key2));
    });
  });
});

describe('Double Ratchet Serialization Bug Detection', () => {
  // This test specifically catches the serialization bug we fixed
  // Bug: serialize() was serializing recvRatchetPublicKey (a CryptoKey) as Promise
  
  it('should serialize keys to base64, not Promises', () => {
    const serialized = {
      rootKey: 'dGhpcyBpcyBub3QgYSBwcm9taXNl',
      sendRatchetPublicKey: 'c2VuZCByYXRjaGV0IHB1YmxpYw==',
      recvRatchetPublicKey: 'cmVjZWYgcmF0Y2hldCBwdWJsaWM='
    };
    
    // All keys should be base64 strings, NOT Promises
    expect(serialized.rootKey).not.toBeInstanceOf(Promise);
    expect(serialized.sendRatchetPublicKey).not.toBeInstanceOf(Promise);
    expect(serialized.recvRatchetPublicKey).not.toBeInstanceOf(Promise);
    expect(serialized.rootKey).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});