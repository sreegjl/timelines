import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/index.css'
import './viewer.css'
import ViewerApp from './ViewerApp.jsx'
import { initI18n, detectLocale } from '../i18n'
import { VIEWER_NAMESPACES } from '../i18n/config'
import { getAppSettings } from '../utils/appSettings'

// The viewer has no Electron store, so getAppSettings falls through to localStorage.
async function bootstrap() {
  let saved = null
  try {
    saved = (await getAppSettings())?.language || null
  } catch {
    saved = null
  }
  await initI18n({ namespaces: VIEWER_NAMESPACES, locale: detectLocale(saved) })
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ViewerApp />
    </StrictMode>,
  )
}

bootstrap()
