import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Project Pages URL: https://sh4gu4dummy-arch.github.io/gold-hanzi/
  base: '/gold-hanzi/',
  plugins: [react()],
  preview: {
    allowedHosts: true,
  },
})
