import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

// pdf.js decodes JPEG2000 / JBIG2 / ICC-profiled images with wasm it fetches at run time (getDocument's wasmUrl)
const PDFJS_WASM = ['openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm']
const pdfjsWasm = (): Plugin => ({
  name: 'pdfjs-wasm',
  configureServer(server) {
    server.middlewares.use('/pdfjs-wasm', (req, res, next) => {
      const file = PDFJS_WASM.find((f) => req.url?.split('?')[0] === '/' + f)
      if (!file) return next()
      res.setHeader('Content-Type', 'application/wasm')
      res.end(readFileSync(`node_modules/pdfjs-dist/wasm/${file}`))
    })
  },
  generateBundle() {
    for (const f of PDFJS_WASM)
      this.emitFile({ type: 'asset', fileName: `pdfjs-wasm/${f}`, source: readFileSync(`node_modules/pdfjs-dist/wasm/${f}`) })
  },
})

// foliate-js shows a PDF it was given as it is (a scan, tables, a very large file) through its own pdf.js, which finds its
// worker, CSS, cmaps and standard fonts with `new URL(`vendor/pdfjs/${name}`, import.meta.url)`. Vite turns that into an
// `import.meta.glob` it then leaves unresolved in the bundle, so the module throws when loaded and no such PDF can be added.
// Give it explicit URLs instead: the worker and the two stylesheets are bundled, the cmaps and fonts are copied next to the app.
const FOLIATE_PDFJS = 'node_modules/foliate-js/vendor/pdfjs'
const FOLIATE_PDFJS_DIRS = ['cmaps', 'standard_fonts']
const foliatePdfjsFiles = () =>
  FOLIATE_PDFJS_DIRS.flatMap((d) => readdirSync(`${FOLIATE_PDFJS}/${d}`).map((f) => `${d}/${f}`))
const foliatePdfjs = (): Plugin => ({
  name: 'foliate-pdfjs',
  enforce: 'pre',
  transform(code, id) {
    if (!/foliate-js\/pdf\.js$/.test(id.split('?')[0] ?? '')) return
    const steps: [string, string][] = [
      [
        'const pdfjsPath = path => new URL(`vendor/pdfjs/${path}`, import.meta.url).toString()',
        "import workerUrl from './vendor/pdfjs/pdf.worker.mjs?url'\n" +
          "import textLayerCss from './vendor/pdfjs/text_layer_builder.css?raw'\n" +
          "import annotationLayerCss from './vendor/pdfjs/annotation_layer_builder.css?raw'\n" +
          "const pdfjsPath = path => (path === 'pdf.worker.mjs' ? workerUrl : new URL('pdfjs-vendor/' + path, document.baseURI).href)",
      ],
      // JPEG2000 / JBIG2 images (common in scans) are decoded by wasm fetched at run time, same files as the converter uses
      [
        'isEvalSupported: false,',
        "isEvalSupported: false,\n        wasmUrl: new URL('pdfjs-wasm/', document.baseURI).href,",
      ],
      ["await fetchText(pdfjsPath('text_layer_builder.css'))", 'textLayerCss'],
      ["await fetchText(pdfjsPath('annotation_layer_builder.css'))", 'annotationLayerCss'],
    ]
    let out = code
    for (const [from, to] of steps) {
      // a foliate-js update that changes these lines must be looked at, not silently skipped
      if (!out.includes(from)) this.error(`foliate-pdfjs: expected code not found in foliate-js/pdf.js: ${from}`)
      out = out.replace(from, to)
    }
    return { code: out, map: null }
  },
  configureServer(server) {
    server.middlewares.use('/pdfjs-vendor', (req, res, next) => {
      const name = decodeURIComponent(req.url?.split('?')[0] ?? '').replace(/^\//, '')
      if (!foliatePdfjsFiles().includes(name)) return next()
      res.setHeader('Content-Type', 'application/octet-stream')
      res.end(readFileSync(`${FOLIATE_PDFJS}/${name}`))
    })
  },
  generateBundle() {
    for (const f of foliatePdfjsFiles())
      this.emitFile({ type: 'asset', fileName: `pdfjs-vendor/${f}`, source: readFileSync(`${FOLIATE_PDFJS}/${f}`) })
  },
})

export default defineConfig({
  base: './',
  // eye.html is the hidden page eye scrolling runs in, interactive.html the sandbox for scripted EPUBs (each has its own content-security policy, see the files)
  build: { rollupOptions: { input: { main: 'index.html', eye: 'eye.html', interactive: 'interactive.html' } } },
  plugins: [
    react(),
    pdfjsWasm(),
    foliatePdfjs(),
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
        globIgnores: ['**/assets/pdf-*', '**/assets/pdf.worker*', '**/assets/face_mesh*'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/pdf(\.worker)?[.-]/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs' },
          },
          {
            // cmaps and standard fonts for PDFs shown as they are
            urlPattern: ({ url }) => /\/pdfjs-vendor\//.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-vendor' },
          },
          {
            // Face Mesh (eye scrolling, ~17 MB) is only fetched when that mode is switched on
            urlPattern: ({ url }) => /\/assets\/face_mesh/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'face-mesh' },
          },
        ],
        // eye.html and interactive.html are real pages (iframes), not an app route to answer with index.html
        navigateFallbackDenylist: [/(eye|interactive)\.html$/],
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
                accept: [
                  'application/epub+zip',
                  'application/pdf',
                  'text/plain',
                  '.epub',
                  '.pdf',
                  '.txt',
                  '.docx',
                  '.mobi',
                  '.azw',
                  '.azw3',
                  '.fb2',
                  '.cbz',
                  'audio/*',
                  '.m4b',
                  '.mp3',
                ],
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
              'application/x-mobipocket-ebook': ['.mobi', '.azw', '.azw3'],
              'application/x-fictionbook+xml': ['.fb2'],
              'application/vnd.comicbook+zip': ['.cbz'],
              'audio/mp4': ['.m4b', '.m4a'],
              'audio/mpeg': ['.mp3'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
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
