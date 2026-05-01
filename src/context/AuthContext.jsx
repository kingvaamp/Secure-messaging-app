import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { wipeAllKeys } from '@/crypto/keyStorage';
import { clearAllSessions, publishX3DHBundle, getMyIdentityKeyPair } from '@/crypto/sessionManager';
import { runPrekeyMaintenance } from '@/crypto/prekeyManager';

const AuthContext = createContext(null);

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
      }
    }, 5000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      clearTimeout(timeout);
    }).catch(() => {
      setLoading(false);
      clearTimeout(timeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      // Clear profile setup flag when user logs in
      if (session?.user) {
        localStorage.removeItem('vanish_profile_setup');
      }
      
      setLoading(false);

      // Publish X3DH bundle and run prekey maintenance when session is established
      if (session?.user?.id) {
        publishX3DHBundle(session.user.id).catch(() => {});
        try {
          const idKP = await getMyIdentityKeyPair();
          runPrekeyMaintenance(session.user.id, idKP);
        } catch (err) {}
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          scopes: 'email profile',
        }
      });
      
      if (error) {
        setError(error.message);
        return { success: false };
      }
    } catch (err) {
      setError('Erreur de redirection.');
      return { success: false };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await wipeAllKeys();
      clearAllSessions();
    } catch (e) {}

    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  const value = {
    user,
    session,
    loading,
    error,
    signInWithGoogle,
    signOut,
    isDemo: false, // Always production now
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