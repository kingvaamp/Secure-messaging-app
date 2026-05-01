// ============================================
// Security Guard — App-level Privacy Protection
// Handles: visibility-based screen blurring, screenshot detection,
// and biometric (WebAuthn) lock enforcement.
// ============================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { Shield, Fingerprint, Lock } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { toB64, fromB64 } from '@/crypto/primitives';

// ============================================
// WebAuthn Biometric Authentication
// Uses platform authenticator (Touch ID / Face ID / Windows Hello)
// ============================================
async function requestBiometricAuth(supabaseSession) {
  if (!window.PublicKeyCredential) throw new Error('WebAuthn not supported');

  // 1. Request server-issued challenge
  const { data: challengeData, error: challengeError } = await supabase.functions.invoke('webauthn/challenge', {
    headers: { Authorization: `Bearer ${supabaseSession.access_token}` },
    body: {}
  });
  
  if (challengeError || !challengeData?.challenge) {
    throw new Error('Impossible d\'obtenir le challenge du serveur');
  }

  const challengeBytes = fromB64(challengeData.challenge);

  // 2. Run WebAuthn ceremony with server challenge
  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBytes,
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 30000,
        allowCredentials: [], // accept any credential registered on this device
      }
    });
  } catch (e) {
    return false; // User cancelled or biometric failed
  }

  // 3. Submit assertion to server for verification
  const serialized = {
    id: assertion.id,
    rawId: toB64(assertion.rawId),
    response: {
      authenticatorData: toB64(assertion.response.authenticatorData),
      clientDataJSON:    toB64(assertion.response.clientDataJSON),
      signature:         toB64(assertion.response.signature),
    },
    challenge_b64: challengeData.challenge,
  };

  const { data: result } = await supabase.functions.invoke('webauthn/verify', {
    body: serialized,
    headers: { Authorization: `Bearer ${supabaseSession.access_token}` }
  });

  return result?.verified === true;
}

// ============================================
// Privacy Overlay — shown when app loses focus
// Prevents screenshot preview in app switcher
// ============================================
function PrivacyOverlay({ visible }) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center"
      style={{
        backgroundColor: '#000',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
      }}
    >
      <div
        className="flex flex-col items-center gap-4"
        style={{ opacity: 0.4 }}
      >
        <Shield size={48} color="#ff003c" />
        <p
          className="text-[13px] uppercase tracking-[0.2em] font-medium"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          Contenu sécurisé
        </p>
      </div>
    </div>
  );
}

// ============================================
// Biometric Lock Screen
// ============================================
function BiometricLockScreen({ session, onUnlock, onBypass }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const failureCountRef = useRef(0);

  const handleAuth = async () => {
    setLoading(true);
    setError('');
    try {
      const success = await requestBiometricAuth(session);
      if (success) {
        failureCountRef.current = 0;
        onUnlock();
      } else {
        failureCountRef.current += 1;
        if (failureCountRef.current >= 3) {
          setError('Trop d\'échecs. Verrouillage de sécurité...');
          setTimeout(onBypass, 1500); // Trigger hard-lock / logout after 3 failures
        } else {
          setError(`Authentification échouée. ${3 - failureCountRef.current} essai(s) restant(s).`);
        }
      }
    } catch (e) {
      setError('Face ID / Touch ID non disponible ou erreur serveur.');
      setTimeout(onBypass, 2000);
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-[998] flex flex-col items-center justify-center gap-6"
      style={{ backgroundColor: '#050000' }}
    >
      {/* Logo */}
      <div className="text-center mb-4">
        <p className="text-[11px] uppercase tracking-[0.3em] font-medium mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          VanishText
        </p>
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
          style={{
            backgroundColor: 'rgba(255, 0, 60, 0.08)',
            border: '1px solid rgba(255, 0, 60, 0.2)',
            boxShadow: '0 0 40px rgba(255, 0, 60, 0.15)',
          }}
        >
          <Lock size={36} color="#ff003c" />
        </div>
      </div>

      <div className="text-center">
        <p className="text-white/80 text-[15px] font-medium mb-1">Application verrouillée</p>
        <p className="text-white/40 text-[12px]">Déverrouillez pour continuer</p>
      </div>

      <button
        onClick={handleAuth}
        disabled={loading}
        className="flex flex-col items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(255, 0, 60, 0.12)',
            border: '1px solid rgba(255, 0, 60, 0.3)',
            boxShadow: loading ? '0 0 20px rgba(255,0,60,0.4)' : 'none',
          }}
        >
          <Fingerprint
            size={32}
            color="#ff003c"
            className={loading ? 'animate-pulse' : ''}
          />
        </div>
        <span className="text-[12px] font-medium" style={{ color: '#ff003c' }}>
          {loading ? 'Vérification…' : 'Face ID / Touch ID'}
        </span>
      </button>

      {error && (
        <p className="text-[11px] text-center px-8" style={{ color: 'rgba(255,80,80,0.8)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================
// Main SecurityGuard Component
// Wraps the entire authenticated app.
// Activates based on securitySettings from AppContext.
// ============================================
export default function SecurityGuard({ children }) {
  const { securitySettings } = useApp();
  const { session, signOut } = useAuth();
  const [privacyOverlayVisible, setPrivacyOverlayVisible] = useState(false);
  const [biometricLocked, setBiometricLocked] = useState(false);
  const lockTimerRef = useRef(null);

  // ── Visibility-based Screen Privacy ──────────────────────────────────────
  // When blockScreenshots is on: show a black overlay when the page hides.
  // This prevents the app content from appearing in:
  //   - App switcher previews (iOS/Android)
  //   - "Print to PDF" capture
  //   - OS-level screenshot preview flash
  useEffect(() => {
    if (!securitySettings.blockScreenshots) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setPrivacyOverlayVisible(true);
      } else {
        // Small delay so the overlay is visible briefly when app returns
        setTimeout(() => setPrivacyOverlayVisible(false), 300);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [securitySettings.blockScreenshots]);

  // ── CSS-level Selection Prevention ───────────────────────────────────────
  // Prevent text selection on message content (makes copy-paste harder,
  // prevents trivial JS-console data extraction via window.getSelection)
  useEffect(() => {
    if (securitySettings.blockScreenshots) {
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    } else {
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    }
  }, [securitySettings.blockScreenshots]);

  // ── Biometric Lock — Auto-lock after inactivity ───────────────────────────
  useEffect(() => {
    if (!securitySettings.faceIdLock) {
      setBiometricLocked(false);
      return;
    }

    // Lock after 5 minutes of inactivity (browser blur counts as inactivity)
    const LOCK_AFTER_MS = 5 * 60 * 1000;

    const resetTimer = () => {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        setBiometricLocked(true);
      }, LOCK_AFTER_MS);
    };

    // Lock immediately when window loses focus
    const handleBlur = () => {
      if (securitySettings.faceIdLock) {
        setBiometricLocked(true);
      }
    };

    resetTimer();
    window.addEventListener('blur', handleBlur);
    ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach((e) =>
      document.addEventListener(e, resetTimer, { passive: true })
    );

    return () => {
      clearTimeout(lockTimerRef.current);
      window.removeEventListener('blur', handleBlur);
      ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach((e) =>
        document.removeEventListener(e, resetTimer)
      );
    };
  }, [securitySettings.faceIdLock]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {children}

      {/* Privacy overlay (screenshot / app-switcher protection) */}
      <PrivacyOverlay visible={privacyOverlayVisible && !biometricLocked} />

      {/* Biometric lock screen */}
      {biometricLocked && securitySettings.faceIdLock && (
        <BiometricLockScreen
          session={session}
          onUnlock={() => setBiometricLocked(false)}
          onBypass={() => {
            // Hard lock -> force logout on max failures or missing auth
            signOut();
          }}
        />
      )}
    </>
  );
}
