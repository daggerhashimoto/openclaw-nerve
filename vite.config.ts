import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync, existsSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// HTTPS is enabled only if both cert files exist, unless explicitly disabled for tunneled/local dev.
const certPath = './certs/cert.pem'
const keyPath = './certs/key.pem'
const certsExist = existsSync(certPath) && existsSync(keyPath)
const httpsEnabled = process.env.VITE_DISABLE_HTTPS !== 'true' && certsExist
const httpsConfig = httpsEnabled
  ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
  : undefined

// Port is configurable via VITE_PORT env var (default: 3080)
const port = parseInt(process.env.VITE_PORT || '3080', 10)
const apiTarget = `http://localhost:${process.env.PORT || '3081'}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port,
    host: process.env.VITE_HOST || '127.0.0.1',
    https: httpsConfig,
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: apiTarget,
        ws: true,
      },
    },
  },
  build: {
    sourcemap: false, // No sourcemaps in production
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.split(path.sep).join('/');
          if (!normalized.includes('/node_modules/')) return undefined;

          // Core React libraries (most stable, cache-friendly)
          if (
            normalized.includes('/node_modules/react/') ||
            normalized.includes('/node_modules/react-dom/') ||
            normalized.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }

          // Markdown rendering (heavy with highlight.js)
          if (
            normalized.includes('/node_modules/react-markdown/') ||
            normalized.includes('/node_modules/remark-gfm/') ||
            normalized.includes('/node_modules/highlight.js/')
          ) {
            return 'markdown';
          }

          // Charts (loaded only when chat messages contain chart blocks)
          if (
            normalized.includes('/node_modules/recharts/') ||
            normalized.includes('/node_modules/victory-vendor/') ||
            normalized.includes('/node_modules/d3-')
          ) {
            return 'charts-vendor';
          }
          if (normalized.includes('/node_modules/lightweight-charts/')) {
            return 'lightweight-charts';
          }

          // CodeMirror editor shell (loaded only when file editing is opened)
          if (
            normalized.includes('/node_modules/@codemirror/state/') ||
            normalized.includes('/node_modules/@codemirror/view/') ||
            normalized.includes('/node_modules/@codemirror/commands/') ||
            normalized.includes('/node_modules/@codemirror/search/') ||
            normalized.includes('/node_modules/@codemirror/language/') ||
            normalized.includes('/node_modules/@lezer/highlight/') ||
            normalized.includes('/node_modules/style-mod/') ||
            normalized.includes('/node_modules/w3c-keyname/') ||
            normalized.includes('/node_modules/crelt/')
          ) {
            return 'editor-vendor';
          }

          // UI components (radix + lucide icons)
          if (normalized.includes('/node_modules/lucide-react/')) {
            return 'ui-vendor';
          }

          // Utility libraries
          if (
            normalized.includes('/node_modules/clsx/') ||
            normalized.includes('/node_modules/tailwind-merge/') ||
            normalized.includes('/node_modules/class-variance-authority/') ||
            normalized.includes('/node_modules/dompurify/')
          ) {
            return 'utils';
          }

          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
