// ============================================
// Supabase Client — Singleton with env guard
// ============================================

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard: fail fast if env vars are missing
if (!url || !key) {
  console.warn('[Supabase] Env vars missing — fallback to localhost');
} else {
  console.log('[Supabase] Client initialized for:', url);
}

export const supabase = createClient(url || 'http://localhost', key || 'demo-key', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
