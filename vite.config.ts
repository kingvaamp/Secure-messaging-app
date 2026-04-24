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
    // Build-time constant: true in development, false in production.
    // Enables complete tree-shaking of demo data from production bundles.
    __DEV_DEMO__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
});

