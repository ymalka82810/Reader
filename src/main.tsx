import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { migrate } from './lib/db'
import { requestPersistence } from './lib/storage'

// upgrade stored records first; a failed migration must not keep the app from opening
migrate()
  .catch(console.error)
  .then(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )

// ask the browser not to evict the library (IndexedDB) under storage pressure
requestPersistence()
