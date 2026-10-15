import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,mjs,woff2}'],
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
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
