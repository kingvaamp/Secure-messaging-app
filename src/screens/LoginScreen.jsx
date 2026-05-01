import { Lock, Shield, LogOut, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PlasmaBackground from '@/components/PlasmaBackground';

export default function LoginScreen() {
  const { signInWithGoogle, loading, user, signOut, error } = useAuth();

  const handleGoogleLogin = async () => {
    await signInWithGoogle();
  };

  const handleLogout = async () => {
    localStorage.removeItem('vanish_profile_setup');
    localStorage.removeItem('vanish_user_name');
    localStorage.removeItem('vanish_user_phone');
    localStorage.removeItem('vanish_user_pseudo');
    await signOut();
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center px-6">
        <PlasmaBackground opacity={1} />
        <div className="relative z-10 text-center">
          <RefreshCw size={32} className="animate-spin mx-auto mb-4" style={{ color: '#ff003c' }} />
          <p className="text-white/60">Vérification de la session...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center px-6">
        <PlasmaBackground opacity={1} />
        
        <div className="relative z-10 text-center space-y-6 max-w-xs">
          <div className="w-24 h-24 mx-auto rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,0,60,0.15)' }}>
            <Shield size={48} style={{ color: '#ff003c' }} />
          </div>
          
          <div>
            <h2 className="text-xl font-medium text-white">Session Active</h2>
            
            <div className="mt-3 px-4 py-2 rounded-lg inline-block bg-green-500/20 border border-green-500/40">
              <span className="text-sm font-medium text-green-400">
                ✅ Mode PRODUCTION
              </span>
            </div>
            
            <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {user.email || user.user_metadata?.full_name || 'Utilisateur connecté'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
              ID: {user.id?.substring(0, 8)}...
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="w-full py-3 rounded-xl text-sm font-medium text-white border flex items-center justify-center gap-2"
            style={{ 
              borderColor: 'rgba(255,0,60,0.3)', 
              backgroundColor: 'rgba(255,0,60,0.1)'
            }}
          >
            <LogOut size={16} />
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-6">
      <PlasmaBackground opacity={1} />

      {/* Logo */}
      <div className="relative z-10 text-center mb-12 mt-8">
        <h1 className="text-5xl font-light tracking-[0.15em] mb-3">
          <span style={{ color: '#ff003c', textShadow: '0 0 30px rgba(255,0,60,0.5)' }}>Vanish</span>
          <span className="text-white">Text</span>
        </h1>
        <p className="text-[10px] tracking-[0.4em] uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Messagerie Sécurisée
        </p>
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-xs space-y-6">
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,0,60,0.08)' }}>
            <Shield size={48} style={{ color: '#ff003c' }} />
          </div>
          <h2 className="text-lg font-medium text-white mb-2">Bienvenue</h2>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Connectez-vous pour commencer
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg" style={{ backgroundColor: 'rgba(255,0,60,0.1)', border: '1px solid rgba(255,0,60,0.3)' }}>
            <AlertCircle size={16} style={{ color: '#ff003c' }} />
            <span className="text-sm" style={{ color: '#ff003c' }}>{error}</span>
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-4 rounded-xl text-base font-medium text-white border transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
          style={{ 
            borderColor: 'rgba(255,255,255,0.15)', 
            backgroundColor: 'rgba(255,255,255,0.05)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {loading ? 'Connexion...' : 'Continuer avec Google'}
        </button>

        <div className="space-y-3 pt-4">
          {[
            'Chiffrement de bout en bout',
            'Messages éphémères (3 min)',
            'Forward Secrecy garanti',
          ].map((feature, i) => (
            <div key={i} className="flex items-center gap-3 px-2">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#ff003c' }} />
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {feature}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-8 left-0 right-0 text-center z-10">
        <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
          <Lock size={9} />
          Signal Protocol · X3DH + Double Ratchet
        </span>
      </div>
    </div>
  );
}