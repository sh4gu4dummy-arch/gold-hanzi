import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Absolute site-root base for Cloudflare Pages (gold-hanzi.pages.dev).
  // Relative './' broke deep links: /practice/:id resolved assets to
  // /practice/assets/... (HTML fallback). GH Pages overrides via
  // `vite build --base=/gold-hanzi/` in .github/workflows/pages-main.yml.
  base: '/',
  plugins: [react()],
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
})
