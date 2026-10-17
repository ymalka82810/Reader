import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:4173',
    // the specs read the Hebrew UI; the app picks its language from the browser
    locale: 'he-IL',
    serviceWorkers: 'block',
    // skip the first-run tap-zone hint, which covers the book until dismissed
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'reader:tapHelpSeen', value: '1' }] }],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
