import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    // `ANALYZE=1 npm run build` writes dist-stats.html (treemap of the bundle).
    !!process.env.ANALYZE && visualizer({ filename: 'dist-stats.html', gzipSize: true }),
    VitePWA({
      registerType: 'autoUpdate',
      // registered by src/lib/serviceWorker.ts, which skips the Android app
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'maskable-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,mjs,woff2}'],
        // pdf.js (~2 MB with its worker) is only needed when importing a PDF, so keep it out of the
        // install-time precache and cache it on first use instead.
        globIgnores: ['**/assets/pdf-*', '**/assets/pdf.worker*'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/pdf(\.worker)?[.-]/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs' },
          },
        ],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        importScripts: ['share-target.js'],
      },
      manifest: {
        name: 'קורא ספרים',
        short_name: 'קורא',
        lang: 'he',
        dir: 'rtl',
        start_url: './',
        display: 'standalone',
        background_color: '#f6f6f4',
        theme_color: '#2b6cb0',
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'files',
                accept: ['application/epub+zip', 'application/pdf', 'text/plain', '.epub', '.pdf', '.txt'],
              },
            ],
          },
        },
        file_handlers: [
          {
            action: './',
            accept: {
              'application/epub+zip': ['.epub'],
              'application/pdf': ['.pdf'],
              'text/plain': ['.txt'],
            },
          },
        ],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
