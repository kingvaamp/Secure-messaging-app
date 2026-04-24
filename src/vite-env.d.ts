/// <reference types="vite/client" />

/**
 * Build-time constant injected by Vite's define block.
 * true  in development (NODE_ENV !== 'production')
 * false in production — the entire demoData.js module tree-shakes out.
 */
declare const __DEV_DEMO__: boolean;
