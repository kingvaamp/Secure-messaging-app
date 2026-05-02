# Vanish Messagerie

Vanish is an end-to-end encrypted (E2EE), privacy-first messaging application. Designed to be completely zero-knowledge, Vanish ensures that no server, not even the infrastructure hosting the signaling and storage, can ever read your messages or access your attachments. It provides ephemeral, peer-to-peer secure communication built on the Signal Protocol's cryptographic primitives.

## 🏗 Architecture Overview

Vanish operates on a decentralized trust model relying on a central signaling server purely for message routing, while all cryptographic operations happen entirely client-side.

*   **Frontend**: React (Vite) with an immersive, glassmorphism UI.
*   **Signaling & Transport**: Supabase Realtime (WebSockets) for message delivery and user presence.
*   **Storage (Encrypted Blob Storage)**: Supabase Storage for encrypted file attachments.
*   **Cryptography**: WebCrypto API for native, high-performance cryptographic primitives (AES-GCM, ECDH, HKDF, HMAC).
*   **Local Persistence**: IndexedDB with envelope encryption. Data is encrypted at rest in the browser and never synced to the cloud.

The architecture strictly separates the **Transport Layer** (Supabase) from the **Security Layer** (Double Ratchet / WebCrypto). Supabase acts only as an untrusted relayer of ciphertext.

## 🔒 How End-to-End Encryption Works

Vanish uses a full implementation of the **Double Ratchet Algorithm** combined with **X3DH (Extended Triple Diffie-Hellman)** for asynchronous key agreement.

1.  **Identity & Prekeys (X3DH)**: When a user registers, they generate a long-term Identity Key (Ed25519) and a set of One-Time Prekeys (OPKs) and a Signed Prekey (SPK). The public keys are uploaded to Supabase.
2.  **Session Establishment**: When Alice wants to message Bob, she fetches Bob's prekeys to perform an X3DH key agreement. This derives a shared Master Secret without Bob needing to be online.
3.  **The Double Ratchet**: The Master Secret seeds the Double Ratchet. Every message sent or received advances a KDF (Key Derivation Function) chain, providing:
    *   **Forward Secrecy (FS)**: Compromising a current key does not compromise past messages.
    *   **Post-Compromise Security (PCS)**: If a key is compromised, subsequent messages will self-heal and become secure again after a new Diffie-Hellman exchange.
4.  **Group Messaging**: Employs a pairwise fan-out model. Group messages are individually encrypted for each member using unique session keys (`conversationId::senderId`), ensuring cryptographic isolation between participants.

## 🛡 Security Features

*   **Zero-Knowledge Attachments**: Files up to 50MB are encrypted locally using a fresh AES-256-GCM key per file. Only the ciphertext is uploaded to Supabase Storage. The decryption key travels safely inside the Double Ratchet payload.
*   **Sealed Sender (Metadata Anonymity)**: Message payloads are encrypted such that the signaling server does not know who is sending the message. The sender's identity certificate is embedded inside the ciphertext.
*   **At-Rest Encryption**: Local message history is stored in IndexedDB but wrapped in AES-256-GCM envelope encryption. The Master Wrapping Key never leaves the browser's secure enclave.
*   **Ephemeral Messaging (TTL)**: Messages self-destruct locally after their Time-To-Live expires, triggering local deletion and cryptographic wipe of associated encrypted blob attachments.
*   **Safety Numbers**: Out-of-band verification via key fingerprints protects against Man-In-The-Middle (MITM) attacks.

## 🚀 Setup Guide

### Prerequisites
*   Node.js (v18+)
*   npm or yarn
*   A Supabase project

### 1. Environment Variables
Create a `.env` file in the root directory and add your Supabase credentials:
```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 2. Supabase Setup
You must configure the following in your Supabase project:
*   **Auth**: Enable Email/Password or desired OAuth providers.
*   **Database**: Set up the `profiles`, `public_keys`, and `groups` tables (refer to the SQL migrations in the documentation).
*   **Storage**: Create a public bucket named `vanish-attachments`. Set RLS policies to allow authenticated users to INSERT to `{user_id}/*` and SELECT globally.

### 3. Installation
```bash
npm install
npm run dev
```
The app will be available at `http://localhost:3000`.

## 🚢 Production Deployment (Vercel)

Vanish is optimized for deployment on Vercel. Because this is an E2EE app with external storage, you **must** follow these steps to ensure authentication and attachments work.

### 1. Vercel Configuration
1.  Connect your GitHub repository to Vercel.
2.  Add Environment Variables:
    *   `VITE_SUPABASE_URL`
    *   `VITE_SUPABASE_ANON_KEY`
3.  Deploy. Vercel will use the `vercel.json` rewrite rule to handle SPA routing.

### 2. Supabase "Trust" Setup
Supabase will block logins and storage downloads from your new domain until you authorize it:
1.  **Auth Redirects**: Go to `Auth -> URL Configuration`. Set the **Site URL** to your Vercel URL. Add `https://your-app.vercel.app/**` to **Redirect URIs**.
2.  **CORS**: Go to `Storage -> Settings`. Add your Vercel URL to the **Allowed Origins** list. This allows the browser to download encrypted blobs for local decryption.
3.  **Google OAuth**: Ensure your Google Cloud Console "Authorized Redirect URIs" matches the callback URL in the Supabase Google Provider settings.

## 🤝 Contribution Rules

We take security and cryptography seriously. To contribute to Vanish:

1.  **Never Roll Your Own Crypto**: All cryptographic changes must use standard primitives provided by the WebCrypto API. Do not introduce custom algorithms.
2.  **Zero-Knowledge Principle**: No plaintext data, metadata, or keys should ever be transmitted to or stored on the server. If adding a feature (like read receipts or typing indicators), it must be E2EE.
3.  **No Server-Side State**: The server remains an untrusted relayer. Do not build features that rely on the server keeping state of user conversations.
4.  **Testing**: Any changes to the `src/crypto/` module must pass the integration test suite (`vanish.integration.test.js`). Run tests before submitting a PR.
5.  **Review Process**: All code touching key derivation, session management, or storage requires a rigorous security review by a maintainer.
