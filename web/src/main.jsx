import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/theme.css'       // shared base (from mockups/theme.css)
import './pages/dashboard.css'    // R4 base + dashboard-specific (global; R4 wins shared classes)
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
