// src/data/useDemoData.ts
//
// Returns demo data in development builds; returns empty/null values in
// production so the demoData.js module is never referenced and tree-shakes
// out of the production bundle entirely.

import {
  DEMO_CONTACTS,
  DEMO_CONVERSATIONS,
  DEMO_CALLS,
  DEMO_CURRENT_USER,
  DEMO_CURRENT_USER_BOB,
  DEMO_STATS,
  DEFAULT_SECURITY_SETTINGS,
} from '@/data/demoData';

// ── Empty production fallbacks ────────────────────────────────────────────────
const EMPTY_STATE = {
  contacts:         [] as unknown[],
  conversations:    [] as unknown[],
  calls:            [] as unknown[],
  currentUser:      null as unknown,
  currentUserBob:   null as unknown,
  stats:            { messages: 0, chats: 0, calls: 0 },
  securitySettings: DEFAULT_SECURITY_SETTINGS, // config, not PII — always included
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns demo data in development builds (__DEV_DEMO__ === true).
 * In production builds, Vite replaces __DEV_DEMO__ with the literal `false`,
 * the if-branch dead-code eliminates, and the dynamic import is never
 * reached — so rollup/esbuild can safely tree-shake demoData.js out entirely.
 */
export function useDemoData() {
  if (!__DEV_DEMO__) {
    // Production: return empty/null — demoData.js never imported
    return EMPTY_STATE;
  }

  return {
    contacts:         DEMO_CONTACTS,
    conversations:    DEMO_CONVERSATIONS,
    calls:            DEMO_CALLS,
    currentUser:      DEMO_CURRENT_USER,
    currentUserBob:   DEMO_CURRENT_USER_BOB,
    stats:            DEMO_STATS,
    securitySettings: DEFAULT_SECURITY_SETTINGS,
  };
}
