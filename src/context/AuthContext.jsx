import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isDemoMode } from '@/lib/supabase';
import { wipeAllKeys } from '@/crypto/keyStorage';
import { clearAllSessions, publishX3DHBundle, getMyIdentityKeyPair } from '@/crypto/sessionManager';
import { runPrekeyMaintenance } from '@/crypto/prekeyManager';

const AuthContext = createContext(null);

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-key';

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      // Publish the full X3DH prekey bundle whenever a real (non-demo) session is established
      if (session?.user?.id && !isDemoMode()) {
        publishX3DHBundle(session.user.id).catch(() => {
          // Non-fatal — bundle will be re-published on next login
        });
        
        try {
          const idKP = await getMyIdentityKeyPair(); // from sessionManager
          runPrekeyMaintenance(session.user.id, idKP); // non-blocking, fire-and-forget
        } catch (err) {
          console.warn('Failed to start prekey maintenance:', err);
        }
      }
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
    
    const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-proxy/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ phone })
    });

    if (res.status === 429) {
      const { retry_after } = await res.json();
      return { success: false, rateLimited: true, retryAfter: retry_after };
    }

    if (!res.ok) {
      setError('Échec de l\'envoi du code');
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

    const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-proxy/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ phone, token })
    });

    if (res.status === 429) {
      const body = await res.json();
      return { success: false, rateLimited: true, retryAfter: body.retry_after };
    }

    if (!res.ok) {
      const body = await res.json();
      return { success: false, attemptsRemaining: body.attempts_remaining };
    }

    const { session: newSession, user: newUser } = await res.json();
    
    // Set session manually since we bypassed supabase.auth
    await supabase.auth.setSession(newSession);
    
    setSession(newSession);
    setUser(newUser);
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
      await wipeAllKeys();        // Wipes localStorage records + deletes IndexedDB MWK
      clearAllSessions();         // Clear in-memory session keys
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
