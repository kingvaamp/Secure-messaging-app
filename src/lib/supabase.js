// ============================================
// Supabase Client — Singleton with env guard
// ============================================

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard: fail fast if env vars are missing
if (!url || !key) {
  console.warn('Supabase env vars missing — running in demo mode');
}

export const supabase = createClient(url || 'http://localhost', key || 'demo-key', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Helper: check if we're in demo mode (no real Supabase connection)
export function isDemoMode() {
  return !url || !key || url === 'http://localhost';
}
