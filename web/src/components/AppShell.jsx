import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { logout } from '../auth'
import { DashboardEntryContext } from '../lib/dashboardEntry'
import ViewportTooltip from './ViewportTooltip'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  // { to: '/orders', label: 'Orders' },   // hidden for now (route still works via direct URL)
  { to: '/clients', label: 'Clients' },
  { to: '/strategies', label: 'Strategies' },
  { to: '/backtest', label: 'Backtest' },
  { to: '/history', label: 'History' },
  { to: '/broker', label: 'Broker' },
  { to: '/admin', label: 'Admin' },
]

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const hasEntryMarker = location.state?.pairdeskEntry === 'login'
  const [enteredFromLogin] = useState(() => (
    hasEntryMarker
    && navigationType === 'REPLACE'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ))
  const [entryPhase, setEntryPhase] = useState(() => (enteredFromLogin ? 'covered' : 'idle'))
  const revealTimerRef = useRef(null)
  const entryActive = enteredFromLogin && entryPhase !== 'idle'
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  const signalDashboardReady = useCallback(() => {
    if (!enteredFromLogin) return
    setEntryPhase((phase) => (phase === 'covered' ? 'revealing' : phase))
  }, [enteredFromLogin])

  // Capture the one-shot marker locally, then remove it from history so refresh/back never replay it.
  useEffect(() => {
    if (!hasEntryMarker) return
    const nextState = { ...(location.state || {}) }
    delete nextState.pairdeskEntry
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: Object.keys(nextState).length ? nextState : null },
    )
  }, [hasEntryMarker, location.hash, location.pathname, location.search, location.state, navigate])

  // Login creates this cover before route replacement. Reassert it before the dashboard can paint.
  useLayoutEffect(() => {
    const page = document.documentElement
    if (!enteredFromLogin) {
      page.classList.remove('pairdesk-entry-closing', 'pairdesk-entry-covered', 'pairdesk-entry-revealing')
      return
    }
    if (entryPhase === 'covered') {
      page.classList.remove('pairdesk-entry-closing', 'pairdesk-entry-revealing')
      page.classList.add('pairdesk-entry-covered')
    }
  }, [enteredFromLogin, entryPhase])

  // Direct protected routes have no dashboard query to signal readiness. The dashboard also gets a
  // bounded fallback, so an unavailable API can reveal its honest error/loading state instead of
  // trapping the user behind artwork.
  useEffect(() => {
    if (!enteredFromLogin || entryPhase !== 'covered') return undefined
    const fallback = window.setTimeout(
      signalDashboardReady,
      location.pathname === '/' ? 2200 : 90,
    )
    return () => window.clearTimeout(fallback)
  }, [enteredFromLogin, entryPhase, location.pathname, signalDashboardReady])

  useLayoutEffect(() => {
    if (entryPhase !== 'revealing') return undefined

    const page = document.documentElement
    const appbarBottom = document.querySelector('.appbar')?.getBoundingClientRect().bottom ?? 60
    page.style.setProperty('--pairdesk-entry-header-y', `${appbarBottom}px`)
    page.classList.remove('pairdesk-entry-closing', 'pairdesk-entry-covered')
    page.classList.add('pairdesk-entry-revealing')

    const finishReveal = () => {
      window.clearTimeout(revealTimerRef.current)
      page.classList.remove('pairdesk-entry-revealing')
      page.style.removeProperty('--pairdesk-entry-x')
      page.style.removeProperty('--pairdesk-entry-y')
      page.style.removeProperty('--pairdesk-entry-header-y')
      setEntryPhase((phase) => (phase === 'revealing' ? 'idle' : phase))
    }
    const handleAnimationEnd = (event) => {
      if (event.animationName === 'pairdesk-dashboard-reveal') finishReveal()
    }

    page.addEventListener('animationend', handleAnimationEnd)
    revealTimerRef.current = window.setTimeout(finishReveal, 900)
    return () => {
      page.removeEventListener('animationend', handleAnimationEnd)
      window.clearTimeout(revealTimerRef.current)
    }
  }, [entryPhase])

  // Fit the fixed-width (~1372px) dashboard to the viewport on EVERY size, incl. > 1920px monitors,
  // and keep it in sync on resize. Previously the zoom was set once on login-exit and capped at
  // 1.25 (froze at ~1715px wide), so large screens rendered the whole UI small. Zoom scales the
  // layout AND fonts together; the tooltip derives its own factor, so nothing else needs changes.
  useLayoutEffect(() => {
    const applyZoom = () => {
      document.body.style.zoom = String(Math.min(1.9, document.documentElement.clientWidth / 1372))
    }
    applyZoom()
    window.addEventListener('resize', applyZoom)
    return () => window.removeEventListener('resize', applyZoom)
  }, [])

  function handleLogout() {
    const page = document.documentElement
    page.classList.remove('pairdesk-entry-closing', 'pairdesk-entry-covered', 'pairdesk-entry-revealing')
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <DashboardEntryContext.Provider value={{ enteredFromLogin: entryActive, signalDashboardReady }}>
      <div className={`pairdesk-app-shell is-entry-${entryPhase}`}>
        <header className="appbar"><div className="in">
          <div className="brand"><div className="brand-logo"><img src="/logo.png" alt="Young Turtle" /></div></div>
          <nav className={'inav' + (navOpen ? ' nav-open' : '')}>
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => (isActive ? 'on' : undefined)}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button type="button" className={'nav-toggle' + (navOpen ? ' on' : '')}
            aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen}
            onClick={() => setNavOpen(v => !v)}>
            <span /><span /><span />
          </button>
          <div className="rt">
            <div className="av" onClick={handleLogout} data-tooltip="Log out" tabIndex={0} style={{ cursor: 'pointer' }}>YT</div>
          </div>
        </div></header>
        {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
        <div className="app-shell-content">{children}</div>
        <ViewportTooltip />
      </div>
    </DashboardEntryContext.Provider>
  )
}
