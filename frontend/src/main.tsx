import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { syncDocumentLanguage } from '@/i18n'

// index.html ships `lang="en"` because a static file cannot know the visitor.
// This reconciles it with the detected locale before the first paint, so a
// Spanish visitor never has a document that claims to be English.
syncDocumentLanguage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
