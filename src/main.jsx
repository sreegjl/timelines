import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.jsx'
import { initI18n, detectLocale } from './i18n'
import { APP_NAMESPACES } from './i18n/config'
import { getAppSettings } from './utils/appSettings'

// Locale resolves before first paint so no untranslated frame is shown.
async function bootstrap() {
  let saved = null
  try {
    saved = (await getAppSettings())?.language || null
  } catch {
    saved = null
  }
  await initI18n({ namespaces: APP_NAMESPACES, locale: detectLocale(saved) })
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap()
