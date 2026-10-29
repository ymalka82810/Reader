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
import { watchNightAppTheme } from './lib/nightMode'
import { applyA11yClasses, loadSettings } from './lib/settings'
import { isNativeApp } from './lib/updater'
import { hideSplash } from './lib/splash'
import { recoverCrash } from './lib/crashGuard'

// before any work starts again: a file that closed the app last time is set aside, so it cannot close it again
recoverCrash()

document.documentElement.classList.toggle('native-app', isNativeApp)
// iOS Safari only applies :active (the pressed look of buttons) when some touch listener exists
document.addEventListener('touchstart', () => {}, { passive: true })
applyDocumentLocale()
applyA11yClasses(loadSettings())
watchNightAppTheme()

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
  // let React paint the first screen under the splash before fading it out
  requestAnimationFrame(() => requestAnimationFrame(hideSplash))
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
