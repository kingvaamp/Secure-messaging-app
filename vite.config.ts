import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// ⚠️  Security: kimi-plugin-inspect-react exposes React component trees.
// Only loaded in development — NEVER in production builds.
// This prevents message content and auth state from being
// inspectable via DevTools APIs in production.
const devPlugins = process.env.NODE_ENV !== 'production'
  ? [await import('kimi-plugin-inspect-react').then(m => m.inspectAttr())]
  : [];

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [...devPlugins, react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    // Build-time constants: control security posture of the crypto layer.
    // __DEV_DEMO__: true in development (uses plain ECDH), false in production (uses X3DH).
    // __PRIVACY_MODE__: enables privacy-preserving lookups (Tor proxy, PIR, etc.)
    __DEV_DEMO__: JSON.stringify(false),
    __PRIVACY_MODE__: JSON.stringify(false),
  },
});

