import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import './styles.css'
import App from './App'
import { migrate } from './lib/db'
import { applyDocumentLocale } from './i18n'
import { requestPersistence } from './lib/storage'
import { setupServiceWorker } from './lib/serviceWorker'
import { applyA11yClasses, loadSettings } from './lib/settings'
import { isNativeApp } from './lib/updater'

document.documentElement.classList.toggle('native-app', isNativeApp)
applyDocumentLocale()
applyA11yClasses(loadSettings())

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

// ask the browser not to evict the library (IndexedDB) under storage pressure
requestPersistence()
