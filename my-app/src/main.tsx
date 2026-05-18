import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider, ToastViewport } from './contexts/ToastContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
      <ToastViewport />
    </ToastProvider>
  </StrictMode>,
)
