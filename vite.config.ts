import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Cloudflare Pages serves at site root (e.g. gold-hanzi.pages.dev).
  base: './',
  plugins: [react()],
  preview: {
    allowedHosts: true,
  },
})
