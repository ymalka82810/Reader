import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/heebo/400.css'
import '@fontsource/heebo/600.css'
import '@fontsource/heebo/700.css'
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import './styles.css'
import App from './App'
import { migrate } from './lib/db'
import { applyDocumentLocale } from './i18n'
import { requestPersistence } from './lib/storage'
import { setupServiceWorker } from './lib/serviceWorker'
import { applyAppTheme, loadAppTheme } from './lib/appTheme'
import { applyA11yClasses, loadSettings } from './lib/settings'
import { isNativeApp } from './lib/updater'

document.documentElement.classList.toggle('native-app', isNativeApp)
applyDocumentLocale()
applyA11yClasses(loadSettings())
applyAppTheme(loadAppTheme())

const reloading = setupServiceWorker().catch((e) => {
  console.error(e)
  return false
})

// upgrade stored records first; a failed migration must not keep the app from opening
Promise.all([migrate().catch(console.error), reloading]).then(([, reload]) => {
  if (reload) return
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

// A tab opened before a deploy still runs the old main-*.js, whose lazy chunks (pdf, docx…) no longer exist on
// the server. Reload once to pick up the new version instead of failing every import.
window.addEventListener('vite:preloadError', (e) => {
  const last = Number(sessionStorage.getItem('reader:chunk-reload') ?? 0)
  if (Date.now() - last < 60_000) return // already tried a moment ago: let the error surface
  sessionStorage.setItem('reader:chunk-reload', String(Date.now()))
  e.preventDefault()
  location.reload()
})

// ask the browser not to evict the library (IndexedDB) under storage pressure
requestPersistence()
