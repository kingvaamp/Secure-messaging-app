import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptPayload } from '../sessionManager';
import * as sealedSender from '../sealedSender';
import * as keyStorage from '../keyStorage';

// Mock dependencies
vi.mock('../sealedSender', () => ({
  openSealedMessage: vi.fn(),
  createSealedMessage: vi.fn(),
  generateAnonymousSenderKey: vi.fn()
}));

// Mock localStorage to prevent environment crashes
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
};

vi.mock('../keyStorage', () => ({
  getMyIdentityKeyPair: vi.fn(),
  loadRatchetSession: vi.fn(),
  saveSessionState: vi.fn(),
  saveIdentityKey: vi.fn(),
  loadIdentityKey: vi.fn(),
  saveSignedPreKey: vi.fn(),
  saveOneTimePreKeys: vi.fn(),
  loadSignedPreKey: vi.fn(),
  loadOneTimePreKey: vi.fn(),
  deleteOneTimePreKey: vi.fn(),
  saveRatchetSession: vi.fn(),
  hasRatchetSession: vi.fn()
}));

// We also need to mock DoubleRatchet and getOrCreateRatchet
// For this strict architectural boundary test, we intercept the engine before DoubleRatchet
vi.mock('../DoubleRatchet', () => ({
  DoubleRatchet: vi.fn()
}));

describe('sessionManager: decryptPayload Architecture Constraints', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('[AI-RULE] Should process a sealedEnvelope payload natively without UI unwrapping', async () => {
    // 1. Arrange: The raw payload as received from Supabase
    const wirePayload = {
      sealedEnvelope: {
        iv: 'fake-iv',
        ciphertext: 'fake-ciphertext',
        anonymousPublicB64: 'fake-pubkey'
      }
    };

    // Mock the inner ratchet message that openSealedMessage returns
    const mockInnerRatchetMessage = JSON.stringify({
      iv: 'inner-iv',
      ciphertext: 'inner-ciphertext',
      messageNumber: 0
    });

    keyStorage.getMyIdentityKeyPair.mockResolvedValue({
      privateKeyECDH: 'mock-private-key'
    });

    sealedSender.openSealedMessage.mockResolvedValue(mockInnerRatchetMessage);

    // 2. Act: Call decryptPayload EXACTLY as the UI should call it (passing the whole wrapper)
    try {
      // It will throw because getOrCreateRatchet isn't fully mocked, but we only 
      // care that openSealedMessage was called correctly.
      await decryptPayload('conv-1', 'contact-1', wirePayload);
    } catch (e) {
      // Catch DoubleRatchet mock errors
    }

    // 3. Assert: The crypto engine correctly detected the envelope and unwrapped it natively
    expect(sealedSender.openSealedMessage).toHaveBeenCalledTimes(1);
    expect(sealedSender.openSealedMessage).toHaveBeenCalledWith(
      expect.anything(),  // Recipient's identity key (CryptoKey)
      'fake-pubkey',      // The anonymous sender key
      { iv: 'fake-iv', ciphertext: 'fake-ciphertext' }
    );
  });

  it('[AI-RULE] Should fail completely if the UI incorrectly strips the sealedEnvelope', async () => {
    // 1. Arrange: The UI mistakenly strips the payload
    const wirePayload = {
      sealedEnvelope: {
        iv: 'fake-iv',
        ciphertext: 'fake-ciphertext',
        anonymousPublicB64: 'fake-pubkey'
      }
    };

    // UI does: const stripped = msg.payload.sealedEnvelope
    const incorrectlyStrippedPayload = wirePayload.sealedEnvelope;

    // 2. Act
    try {
      await decryptPayload('conv-1', 'contact-1', incorrectlyStrippedPayload);
    } catch (e) {}

    // 3. Assert: Because the UI stripped the wrapper, decryptPayload didn't know it was sealed
    // and failed to unwrap it using the Identity Key! This proves why the UI must never touch it.
    expect(sealedSender.openSealedMessage).not.toHaveBeenCalled();
  });
});
