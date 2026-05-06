# VanishText Crypto Architecture

> [!IMPORTANT]
> **READ BEFORE MODIFYING.** 
> This directory (`src/crypto`) contains the core Signal-compliant E2E encryption engine. Modifying payloads, key derivation sequences, or wrapper structures here requires extreme caution to avoid breaking Post-Compromise Security (PCS) or Perfect Forward Secrecy (PFS).

## 1. The SealedSender Payload

To protect metadata from the server, all Double Ratchet messages are wrapped in a `sealedEnvelope` before transmission.

### 1.1 Wire Format
When a message is sent over the wire (to Supabase), it looks exactly like this:
```json
{
  "sealedEnvelope": {
    "iv": "<base64>",
    "ciphertext": "<base64>",
    "anonymousPublicB64": "<base64>"
  },
  "x3dh": null
}
```

### 1.2 Unwrapping Process
The React UI (`ChatsScreen.jsx`) MUST NOT attempt to unwrap this envelope. 
The UI passes the entire payload to `decryptPayload(sessionId, contactId, msg.payload)`.

Inside `decryptPayload`, the engine performs the following:
1. Detects `payload.sealedEnvelope`.
2. Uses the **Recipient's Private Identity Key** (`myKP.privateKeyECDH`) and the `anonymousPublicB64` to derive a shared secret.
3. Performs AES-GCM decryption on the `iv` and `ciphertext`.
4. The decrypted result is the true inner payload (the Double Ratchet message).

### 1.3 Inner Payload Format
Once unwrapped, the engine receives the actual Double Ratchet message:
```json
{
  "iv": "<base64>",
  "ciphertext": "<base64>",
  "messageNumber": 0,
  "ratchetPublicKey": "<base64>",
  "x3dh": {
    "senderIdentityKey": "<base64>",
    "ephemeralKey": "<base64>",
    "signedPreKeyId": 1,
    "opkKeyId": 12
  }
}
```
*Note: `x3dh` is only present on the very first message of a session (the Initializing Message).*

## 2. Double Ratchet State Machine
- `sessionManager.js` handles session persistence via `IndexedDB`.
- Do not attempt to manually inject keys into the Ratchet state. 
- If decryption throws `Authentification échouée`, the MAC has failed. This is not a bug; it is the protocol enforcing PFS when keys are out of sync.
