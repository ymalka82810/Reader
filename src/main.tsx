import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { requestPersistence } from './lib/storage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ask the browser not to evict the library (IndexedDB) under storage pressure
requestPersistence()
