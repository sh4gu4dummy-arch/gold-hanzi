import react from '@vitejs/plugin-react'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

/** Ensure lesson stroke chunks + split catalogs exist before Vite analyzes globs. */
function snappyDataPlugin(): Plugin {
  let ran = false
  const run = () => {
    if (ran) return
    ran = true
    const script = path.join(root, 'scripts/generate-snappy-data.mjs')
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      throw new Error('generate-snappy-data.mjs failed')
    }
  }
  return {
    name: 'snappy-data',
    buildStart() {
      run()
    },
    configureServer() {
      run()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Absolute site-root base for Cloudflare Pages (gold-hanzi.pages.dev).
  // Relative './' broke deep links: /practice/:id resolved assets to
  // /practice/assets/... (HTML fallback). GH Pages overrides via
  // `vite build --base=/gold-hanzi/` in .github/workflows/pages-main.yml.
  base: '/',
  plugins: [snappyDataPlugin(), react()],
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
})
