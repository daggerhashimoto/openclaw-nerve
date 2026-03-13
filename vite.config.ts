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
        manualChunks: {
          // Core React libraries (most stable, cache-friendly)
          'react-vendor': ['react', 'react-dom'],
          
          // Markdown rendering (heavy with highlight.js)
          'markdown': ['react-markdown', 'remark-gfm', 'highlight.js'],
          
          // UI components (radix + lucide icons)
          'ui-vendor': ['lucide-react'],
          
          // Utility libraries
          'utils': ['clsx', 'tailwind-merge', 'class-variance-authority', 'dompurify'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
