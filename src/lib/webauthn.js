import { supabase } from '@/lib/supabase';
import { toB64, fromB64 } from '@/crypto/primitives';

/**
 * Register a new WebAuthn credential (platform authenticator like Face ID / Touch ID).
 * 
 * Flow:
 * 1. Request registration challenge from server
 * 2. Run WebAuthn ceremony to create credential
 * 3. Send attestation to server for verification and storage
 */
export async function registerBiometric(session) {
  if (!window.PublicKeyCredential) {
    throw new Error('WebAuthn non supporté sur ce navigateur');
  }
  const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  if (!available) {
    throw new Error('Face ID / Touch ID non disponible sur cet appareil');
  }

  // 1. Request registration challenge from server
  const { data: challengeData, error: challengeError } = await supabase.functions.invoke('webauthn/register-challenge', {
    headers: { Authorization: `Bearer ${session.access_token}` },
    // A POST request, body is empty
    body: {}
  });

  if (challengeError || !challengeData?.challenge) {
    throw new Error('Erreur lors de la récupération du challenge du serveur');
  }

  const challengeBytes = fromB64(challengeData.challenge);

  // 2. Run WebAuthn ceremony to create credential
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: challengeBytes,
        rp: {
          name: 'VanishText',
          id: window.location.hostname,
        },
        user: {
          id: fromB64(challengeData.userIdBase64 || toB64(new TextEncoder().encode(session.user.id))),
          name: session.user.email || session.user.phone,
          displayName: session.user.user_metadata?.full_name || 'Utilisateur',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },  // ES256
          { type: 'public-key', alg: -257 } // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'direct',
      }
    });
  } catch (err) {
    console.error('WebAuthn creation failed:', err);
    throw new Error('Création de l\'empreinte annulée ou échouée');
  }

  // 3. Send attestation to server
  const serialized = {
    id: credential.id,
    rawId: toB64(credential.rawId),
    response: {
      clientDataJSON: toB64(credential.response.clientDataJSON),
      attestationObject: toB64(credential.response.attestationObject),
    },
    challenge_b64: challengeData.challenge,
  };

  const { data: verifyData, error: verifyError } = await supabase.functions.invoke('webauthn/register-verify', {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: serialized
  });

  if (verifyError || !verifyData?.verified) {
    throw new Error('Le serveur a rejeté l\'enregistrement biométrique');
  }

  return true;
}
