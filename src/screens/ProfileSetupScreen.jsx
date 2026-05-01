import { useState } from 'react';
import { User, Phone, Shield, AtSign, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import PlasmaBackground from '@/components/PlasmaBackground';

export default function ProfileSetupScreen() {
  const { user } = useAuth();
  const { updateCurrentUser, addNotification } = useApp();
  
  const [step, setStep] = useState(1);
  const [name, setName] = useState(user?.user_metadata?.full_name || '');
  const [pseudo, setPseudo] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [pseudoError, setPseudoError] = useState('');

  const checkPseudoAvailability = async (pseudoToCheck) => {
    const cleanPseudo = pseudoToCheck.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (cleanPseudo.length < 3) {
      return { available: false, message: 'Minimum 3 caractères' };
    }
    
    // Check if pseudo is already taken
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('pseudo', cleanPseudo)
      .maybeSingle();
    
    if (error && error.code !== 'PGRST116') {
      // Ignore "no rows returned" error
      return { available: false, message: 'Erreur de vérification' };
    }
    
    if (data) {
      return { available: false, message: 'Pseudo déjà pris' };
    }
    
    return { available: true, message: '' };
  };

  const handleContinue = async () => {
    if (step === 1) {
      if (!name.trim()) {
        addNotification({ type: 'error', text: 'Veuillez entrer votre nom' });
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!pseudo.trim()) {
        addNotification({ type: 'error', text: 'Veuillez entrer un pseudo' });
        return;
      }
      
      const cleanPseudo = pseudo.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cleanPseudo.length < 3) {
        addNotification({ type: 'error', text: 'Pseudo minimum 3 caractères (lettres, chiffres, _)' });
        return;
      }
      
      setLoading(true);
      setPseudoError('');
      
      try {
        // Check if pseudo is available
        const { data: existing, error: checkError } = await supabase
          .from('profiles')
          .select('id')
          .eq('pseudo', cleanPseudo)
          .maybeSingle();
        
        if (checkError && checkError.code !== 'PGRST116') {
          console.error('Pseudo check error:', checkError);
        }
        
        if (existing) {
          setPseudoError('Ce pseudo est déjà utilisé');
          setLoading(false);
          return;
        }
        
        setStep(3);
        setLoading(false);
      } catch (err) {
        console.error('Error checking pseudo:', err);
        setPseudoError('Erreur lors de la vérification');
        setLoading(false);
      }
    } else if (step === 3) {
      setLoading(true);
      
      try {
        // Save profile to Supabase
        const userId = user?.id;
        console.log('Saving profile for user:', userId);
        
        if (userId) {
          // Update existing profile or create new one
          const { error: upsertError } = await supabase
            .from('profiles')
            .upsert({
              id: userId,
              name: name.trim(),
              pseudo: pseudo.toLowerCase().replace(/[^a-z0-9_]/g, ''),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'id',
              ignoreDuplicates: false
            });
          
          if (upsertError) {
            console.error('Profile upsert error:', upsertError);
          }
        }
        
        // Update user profile in app state
        updateCurrentUser({
          name: name.trim(),
          pseudo: pseudo.toLowerCase().replace(/[^a-z0-9_]/g, ''),
          id: user?.id || 'user-' + Date.now(),
        });
        
        // Save to localStorage for persistence
        localStorage.setItem('vanish_profile_setup', 'true');
        
        // Force page reload to reset the app state and show the main app
        window.location.reload();
      } catch (err) {
        console.error('Profile setup error:', err);
        addNotification({ type: 'error', text: 'Erreur lors de la configuration' });
        setLoading(false);
      }
    }
  };

  const steps = [
    { num: 1, label: 'Identité' },
    { num: 2, label: 'Pseudo' },
    { num: 3, label: 'Prêt !' },
  ];

  return (
    <div className="relative w-full h-full flex flex-col">
      <PlasmaBackground opacity={1} />

      {/* Progress */}
      <div className="relative z-10 flex items-center justify-center gap-2 pt-8 pb-4">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                step >= s.num 
                  ? 'bg-[#ff003c] text-white' 
                  : 'bg-white/10 text-white/30'
              }`}
            >
              {step > s.num ? '✓' : s.num}
            </div>
            <span 
              className={`text-[11px] tracking-wide ${
                step >= s.num ? 'text-white/80' : 'text-white/30'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div 
                className={`w-8 h-px mx-1 transition-all ${
                  step > s.num ? 'bg-[#ff003c]' : 'bg-white/10'
                }`} 
              />
            )}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        
        {step === 1 && (
          <div className="w-full max-w-xs space-y-8">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,0,60,0.1)' }}>
                <User size={40} style={{ color: '#ff003c' }} />
              </div>
              <h2 className="text-xl font-medium text-white">Qui êtes-vous ?</h2>
              <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Comment souhaitez-vous apparaître ?
              </p>
            </div>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Votre nom complet"
              className="w-full bg-transparent border-b-2 border-[#ff003c]/30 focus:border-[#ff003c] text-white text-center text-lg py-3 outline-none transition-colors placeholder:text-white/20"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
            />

            <button
              onClick={handleContinue}
              className="w-full py-3 rounded-lg text-sm font-medium text-white transition-all active:scale-[0.98]"
              style={{ backgroundColor: '#ff003c' }}
            >
              Continuer
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="w-full max-w-xs space-y-6">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,0,60,0.1)' }}>
                <AtSign size={40} style={{ color: '#ff003c' }} />
              </div>
              <h2 className="text-xl font-medium text-white">Choisissez un pseudo</h2>
              <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Vos contacts vous trouveront avec ce pseudo
              </p>
            </div>

            <div className="relative">
              <span className="absolute left-4 top-3.5 text-white/30">@</span>
              <input
                type="text"
                value={pseudo}
                onChange={(e) => {
                  // Only allow alphanumeric and underscore
                  const clean = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
                  setPseudo(clean);
                  setPseudoError('');
                }}
                placeholder="mon_pseudo"
                className="w-full bg-transparent border-b-2 border-[#ff003c]/30 focus:border-[#ff003c] text-white text-center text-lg py-3 pl-8 outline-none transition-colors placeholder:text-white/20"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
              />
            </div>
            
            {pseudoError && (
              <div className="flex items-center justify-center gap-2 text-[#ff003c]">
                <AlertCircle size={14} />
                <span className="text-sm">{pseudoError}</span>
              </div>
            )}
            
            <p className="text-[11px] text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Lettres, chiffres et underscores uniquement
            </p>

            <button
              onClick={handleContinue}
              disabled={loading}
              className="w-full py-3 rounded-lg text-sm font-medium text-white transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: '#ff003c' }}
            >
              {loading ? 'Vérification...' : 'Continuer'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="w-full max-w-xs space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center text-5xl animate-bounce" style={{ backgroundColor: 'rgba(255,0,60,0.1)' }}>
                🎉
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">Bienvenue, {name.split(' ')[0]} !</h2>
              <p className="text-sm px-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Votre compte est prêt. Vos messages seront désormais chiffrés et éphémères.
              </p>
            </div>

            <div className="pt-4">
              <button
                onClick={handleContinue}
                disabled={loading}
                className="w-full py-4 rounded-xl text-base font-semibold text-white transition-all active:scale-[0.95] flex items-center justify-center gap-2 shadow-lg shadow-[#ff003c]/20"
                style={{ backgroundColor: '#ff003c' }}
              >
                {loading ? 'Lancement...' : 'C\'est parti !'}
                <Check size={20} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Security note */}
      <div className="relative z-10 pb-8 px-6">
        <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg" style={{ backgroundColor: 'rgba(255,0,60,0.05)', border: '1px solid rgba(255,0,60,0.1)' }}>
          <Shield size={14} style={{ color: '#ff003c' }} />
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Vos données sont chiffrées de bout en bout
          </span>
        </div>
      </div>
    </div>
  );
}