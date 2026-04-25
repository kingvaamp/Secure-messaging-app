import { useState, useEffect } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PlasmaBackground from '@/components/PlasmaBackground';

// Rate limiting constants for UI display limits only
const MAX_ATTEMPTS = 5;

export default function LoginScreen() {
  const { signInWithOtp, verifyOtp, signInWithGoogle, error } = useAuth();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);

  // Rate limiting state (driven strictly by server responses)
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for lockout
  useEffect(() => {
    if (Date.now() >= lockoutUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) setLockoutUntil(0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const isLockedOut = Date.now() < lockoutUntil;

  const handlePhoneSubmit = async () => {
    setLocalError('');
    if (!phone || phone.length < 8) {
      setLocalError('Veuillez entrer un numéro valide');
      return;
    }
    setLoading(true);
    const result = await signInWithOtp(phone);
    setLoading(false);
    
    if (result.success) {
      setStep('otp');
    } else if (result.rateLimited) {
      const until = Date.now() + result.retryAfter * 1000;
      setLockoutUntil(until);
      setLocalError(`Trop de requêtes. Réessayez dans ${Math.ceil(result.retryAfter / 60)} min.`);
    } else {
      setLocalError(error || 'Échec de l\'envoi du code');
    }
  };

  const handleOtpSubmit = async () => {
    setLocalError('');

    // Enforce rate limit
    if (isLockedOut) {
      setLocalError(`Trop de tentatives. Réessayez dans ${Math.ceil(countdown / 60)} min.`);
      return;
    }

    if (!otp || otp.length !== 6) {
      setLocalError('Code à 6 chiffres requis');
      return;
    }

    setLoading(true);
    const result = await verifyOtp(phone, otp);
    setLoading(false);

    if (result.success) {
      // Success, AuthContext handles session setup
      setAttemptsLeft(MAX_ATTEMPTS);
    } else if (result.rateLimited) {
      const until = Date.now() + result.retryAfter * 1000;
      setLockoutUntil(until);
      setLocalError(`Trop d'échecs. Réessayez dans ${Math.ceil(result.retryAfter / 60)} min.`);
    } else {
      setAttemptsLeft(result.attemptsRemaining ?? 0);
      setLocalError(`Code invalide. ${result.attemptsRemaining ?? 0} tentative(s) restante(s).`);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    await signInWithGoogle();
    setLoading(false);
  };

  const displayError = localError || error;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-6">
      <PlasmaBackground opacity={1} />

      {/* Logo */}
      <div className="relative z-10 text-center mb-10">
        <h1 className="text-4xl font-light tracking-[0.15em] mb-2">
          <span style={{ color: '#ff003c' }}>Vanish</span>
          <span className="text-white">Text</span>
        </h1>
        <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Transmission Sécurisée
        </p>
      </div>

      {step === 'phone' ? (
        <div className="relative z-10 w-full max-w-xs space-y-5">
          <p className="text-center text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Entrez votre numéro de téléphone
          </p>

          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+221 77 000 0000"
            className="w-full bg-transparent border-b-2 border-[#ff003c]/30 focus:border-[#ff003c] text-white text-center text-lg py-2 outline-none transition-colors placeholder:text-white/20"
            style={{
              boxShadow: '0 1px 0 0 rgba(255, 0, 60, 0.1)',
            }}
            onKeyDown={(e) => e.key === 'Enter' && handlePhoneSubmit()}
          />

          {displayError && (
            <p className="text-xs text-center" style={{ color: '#ff003c' }}>
              {displayError}
            </p>
          )}

          <button
            onClick={handlePhoneSubmit}
            disabled={loading}
            className="w-full py-3 rounded-lg text-sm font-medium text-white transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ backgroundColor: '#ff003c' }}
          >
            {loading ? '…' : 'Continuer'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>
              ou
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full py-3 rounded-lg text-sm font-medium text-white/80 border transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continuer avec Google
          </button>
        </div>
      ) : (
        <div className="relative z-10 w-full max-w-xs space-y-5">
          <button
            onClick={() => setStep('phone')}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            ← Retour
          </button>

          <p className="text-center text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Code envoyé à {phone}
          </p>

          <input
            type="text"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            className="w-full bg-transparent border-b-2 border-[#ff003c]/30 focus:border-[#ff003c] text-white text-center text-2xl tracking-[0.5em] py-2 outline-none transition-colors placeholder:text-white/20"
            maxLength={6}
            onKeyDown={(e) => e.key === 'Enter' && handleOtpSubmit()}
          />

          {displayError && (
            <p className="text-xs text-center" style={{ color: '#ff003c' }}>
              {displayError}
            </p>
          )}

          <button
            onClick={handleOtpSubmit}
            disabled={loading || isLockedOut}
            className="w-full py-3 rounded-lg text-sm font-medium text-white transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ backgroundColor: isLockedOut ? 'rgba(255,0,60,0.3)' : '#ff003c' }}
          >
            {loading ? '…' : isLockedOut ? `Bloqué — ${Math.ceil(countdown / 60)} min` : 'Se connecter'}
          </button>

          {/* Rate limit warning */}
          {!isLockedOut && attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && (
            <div className="flex items-center justify-center gap-1.5">
              <ShieldAlert size={11} style={{ color: 'rgba(255,120,0,0.8)' }} />
              <p className="text-[10px] text-center" style={{ color: 'rgba(255,120,0,0.8)' }}>
                {attemptsLeft} tentative{attemptsLeft > 1 ? 's' : ''} avant blocage temporaire
              </p>
            </div>
          )}

          {/* Lockout countdown */}
          {isLockedOut && (
            <div className="flex flex-col items-center gap-1">
              <ShieldAlert size={18} color="#ff003c" className="animate-pulse" />
              <p className="text-[11px] text-center" style={{ color: '#ff003c' }}>
                Accès bloqué — {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')} restant
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="absolute bottom-8 left-0 right-0 text-center z-10">
        <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          <Lock size={9} />
          MESSAGERIE SÉCURISÉE E2E
        </span>
      </div>
    </div>
  );
}
