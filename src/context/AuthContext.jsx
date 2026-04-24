import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isDemoMode } from '@/lib/supabase';
import { wipeAllKeys } from '@/crypto/keyStorage';
import { clearAllSessions } from '@/crypto/sessionManager';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithOtp = useCallback(async (phone) => {
    setError(null);
    if (isDemoMode()) {
      // Demo mode — accept only the test number, but don't reveal it in error messages
      if (phone === '+15550000000') {
        return { success: true, demo: true };
      }
      setError('Numéro invalide ou non autorisé.');
      return { success: false };
    }
    
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      setError(error.message);
      return { success: false };
    }
    return { success: true };
  }, []);

  const verifyOtp = useCallback(async (phone, token) => {
    setError(null);
    if (isDemoMode()) {
      // Demo mode — accept the test OTP, but don't reveal it in error messages
      if (phone === '+15550000000' && token === '123456') {
        const demoUser = {
          id: 'demo-user-id',
          phone: '+15550000000',
          user_metadata: { full_name: 'Démo Utilisateur' },
        };
        setUser(demoUser);
        setSession({ user: demoUser });
        return { success: true };
      }
      setError('Code invalide. Veuillez réessayer.');
      return { success: false };
    }

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });
    if (error) {
      setError(error.message);
      return { success: false };
    }
    setSession(data.session);
    setUser(data.user);
    return { success: true };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    if (isDemoMode()) {
      const demoUser = {
        id: 'demo-google-id',
        phone: null,
        user_metadata: { full_name: 'Google Utilisateur' },
      };
      setUser(demoUser);
      setSession({ user: demoUser });
      return { success: true };
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
    });
    if (error) {
      setError(error.message);
      return { success: false };
    }
    return { success: true };
  }, []);

  const signOut = useCallback(async () => {
    // Security: wipe all cryptographic key material BEFORE clearing user state
    try {
      await wipeAllKeys();            // Clear localStorage identity + ratchet keys
      clearAllSessions();             // Clear in-memory session keys
      sessionStorage.removeItem('vanish_wrap_key_v2'); // Clear wrapping key
    } catch (e) {
      // Always proceed with sign-out even if key wipe fails
    }

    if (!isDemoMode()) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
  }, []);

  const value = {
    user,
    session,
    loading,
    error,
    signInWithOtp,
    verifyOtp,
    signInWithGoogle,
    signOut,
    isDemo: isDemoMode(),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
