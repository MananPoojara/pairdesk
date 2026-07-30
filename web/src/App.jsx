import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Clients from './pages/Clients'
import Strategies from './pages/Strategies'
import Backtest from './pages/Backtest'
import History from './pages/History'
import Broker from './pages/Broker'
import Admin from './pages/Admin'
import Login from './pages/Login'
import { isLoggedIn } from './auth'

const LoginPreviewV2 = lazy(() => import('./pages/login-variants/v2-quiet-desk'))
const LoginPreviewV3 = lazy(() => import('./pages/login-variants/v3-correlation-observatory'))
const LoginPreviewV4 = lazy(() => import('./pages/login-variants/v4-capital-folio'))

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
})

function PreviewRoute({ children }) {
  return (
    <Suspense fallback={
      <div
        role="status"
        aria-label="Loading login preview"
        style={{ minHeight: '100dvh', background: '#0b1f32' }}
      />
    }>
      {children}
    </Suspense>
  )
}

function RequireAuth({ children }) {
  const location = useLocation()
  if (!isLoggedIn()) {
    const from = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/login" state={{ from }} replace />
  }
  return children
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Temporary, lazy-loaded design bake-off previews. Remove once a variant is chosen. */}
          <Route path="/login-preview-2" element={<PreviewRoute><LoginPreviewV2 /></PreviewRoute>} />
          <Route path="/login-preview-3" element={<PreviewRoute><LoginPreviewV3 /></PreviewRoute>} />
          <Route path="/login-preview-4" element={<PreviewRoute><LoginPreviewV4 /></PreviewRoute>} />
          <Route path="/*" element={
            <RequireAuth>
              <AppShell>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/strategies" element={<Strategies />} />
                  <Route path="/backtest" element={<Backtest />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/broker" element={<Broker />} />
                  <Route path="/admin" element={<Admin />} />
                </Routes>
              </AppShell>
            </RequireAuth>
          } />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
