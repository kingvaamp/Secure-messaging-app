// src/data/useDemoData.ts
//
// Returns demo data in development builds; returns empty/null values in
// production so the demoData.js module is never referenced and tree-shakes
// out of the production bundle entirely.

import { DEFAULT_SECURITY_SETTINGS } from '@/data/demoData';

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

  // Development only: use a Function constructor to bypass static analysis
  // so bundlers see this as unreachable in production and exclude demoData.js.
  // eslint-disable-next-line no-new-func
  const dynamicRequire = new Function('module', 'return require(module)') as (m: string) => Record<string, unknown>;
  const demo = dynamicRequire('@/data/demoData');

  return {
    contacts:         demo.DEMO_CONTACTS,
    conversations:    demo.DEMO_CONVERSATIONS,
    calls:            demo.DEMO_CALLS,
    currentUser:      demo.DEMO_CURRENT_USER,
    currentUserBob:   demo.DEMO_CURRENT_USER_BOB,
    stats:            demo.DEMO_STATS,
    securitySettings: DEFAULT_SECURITY_SETTINGS,
  };
}
