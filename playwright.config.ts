import { defineConfig } from '@playwright/test'

// E2E_PORT lets a run use a free port when 4173 already serves another build
const port = process.env.E2E_PORT ?? '4173'
const origin = `http://localhost:${port}`

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: origin,
    // the specs read the Hebrew UI; the app picks its language from the browser
    locale: 'he-IL',
    serviceWorkers: 'block',
    // skip the first-run tap-zone hint, which covers the book until dismissed
    storageState: {
      cookies: [],
      origins: [{ origin, localStorage: [{ name: 'reader:tapHelpSeen', value: '1' }] }],
    },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
