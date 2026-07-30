import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '../auth'
import { apiGet } from '../api/client'
import './login.css'

function Icon({ name }) {
  if (name === 'user') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.75 19c.65-3.25 2.82-5 6.25-5s5.6 1.75 6.25 5" />
      </svg>
    )
  }

  if (name === 'lock') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5.75" y="10" width="12.5" height="9" rx="2.5" />
        <path d="M8.75 10V7.6A3.25 3.25 0 0 1 12 4.35a3.25 3.25 0 0 1 3.25 3.25V10" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.75 12s3-5.25 8.25-5.25S20.25 12 20.25 12 17.25 17.25 12 17.25 3.75 12 3.75 12Z" />
      <circle cx="12" cy="12" r="2.25" />
    </svg>
  )
}

function CapitalRail({ resultRef }) {
  return (
    <svg className="login-capital-rail" viewBox="0 0 920 420" role="img" aria-labelledby="capital-rail-title capital-rail-description">
      <title id="capital-rail-title">Client capital routed through a pair strategy into account profit and loss</title>
      <desc id="capital-rail-description">Four managed client accounts combine into one capital allocation, separate into active and hedge market legs, then consolidate into account-level profit and loss.</desc>

      <g className="capital-rail-frame" fill="none">
        <path d="M350 109H720V311H350" />
        <path d="M350 120v-11h11M709 109h11v11M350 300v11h11M709 311h11v-11" />
      </g>

      <g className="capital-rail-labels">
        <text className="capital-label capital-label-primary" x="70" y="91">CLIENT CAPITAL</text>
        <text className="capital-label capital-label-secondary" x="70" y="111">MANAGED ACCOUNTS</text>
        <text className="capital-label capital-label-primary" x="350" y="91">PAIR STRATEGY</text>
        <text className="capital-label capital-label-secondary" x="350" y="331">ACTIVE LEG / HEDGE LEG</text>
      </g>
      <g className="capital-result-labels">
        <text className="capital-label capital-label-primary" x="760" y="91">ACCOUNT P&amp;L</text>
        <text className="capital-label capital-label-secondary" x="760" y="111">CONSOLIDATED</text>
      </g>

      <g className="capital-client-terminals">
        <rect x="68" y="132" width="12" height="12" />
        <rect x="68" y="180" width="12" height="12" />
        <rect x="68" y="228" width="12" height="12" />
        <rect x="68" y="276" width="12" height="12" />
      </g>

      <g className="capital-client-lines" fill="none">
        <path className="capital-flow-draw capital-flow-in" pathLength="1" d="M80 138h72c57 0 61 72 133 72" />
        <path className="capital-flow-draw capital-flow-in" pathLength="1" d="M80 186h88c47 0 54 24 117 24" />
        <path className="capital-flow-draw capital-flow-in" pathLength="1" d="M80 234h88c47 0 54-24 117-24" />
        <path className="capital-flow-draw capital-flow-in" pathLength="1" d="M80 282h72c57 0 61-72 133-72" />
        <path className="capital-flow-draw capital-flow-trunk" pathLength="1" d="M285 210h55" />
      </g>

      <path className="capital-strategy-mean" d="M350 210H725" />
      <g className="capital-spread-connectors">
        <path d="M424 177v66" />
        <path d="M493 159v102" />
        <path d="M560 177v66" />
        <path d="M626 174v72" />
        <path d="M683 197v26" />
      </g>

      <path
        className="capital-flow-draw capital-strategy-leg is-orange"
        pathLength="1"
        d="M350 210c70 0 75-70 150-50 65 18 50 100 125 86 45-8 60-36 100-36"
      />
      <path
        className="capital-flow-draw capital-strategy-leg is-sky"
        pathLength="1"
        d="M350 210c70 0 75 70 150 50 65-18 50-100 125-86 45 8 60 36 100 36"
      />

      <g className="capital-strategy-gates">
        <path d="m340 210 10-10 10 10-10 10Z" />
        <path d="m725 210 9-9 9 9-9 9Z" />
      </g>

      <g className="capital-leg-key">
        <path className="is-orange" d="M410 352h24" />
        <text x="441" y="356">MIDCAP SELECT</text>
        <path className="is-sky" d="M550 352h24" />
        <text x="581" y="356">NIFTY 50</text>
      </g>

      <path
        className="capital-flow-draw capital-flow-return"
        pathLength="1"
        d="M743 210h28l25-12 26 16 29-36 37-19"
      />
      <g className="capital-result-rays" aria-hidden="true">
        <path d="M890 138v8M890 172v8M869 159h8M903 159h8" />
      </g>
      <rect ref={resultRef} className="capital-return-end" x="884" y="153" width="12" height="12" />
    </svg>
  )
}

export default function Login() {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const resultRef = useRef(null)
  const userRef = useRef(null)
  const passRef = useRef(null)
  const submittingRef = useRef(false)
  const coverageTimerRef = useRef(null)
  const navigationTimerRef = useRef(null)
  const destinationRef = useRef('/')
  const didNavigateRef = useRef(false)

  // Dashboard pages intentionally use a fixed-width body zoom. Login is fluid, so hold zoom at one
  // only while this route is mounted, then restore the dashboard's exact scaling formula.
  useLayoutEffect(() => {
    const holdLoginZoom = () => { document.body.style.zoom = '1' }
    holdLoginZoom()
    window.addEventListener('resize', holdLoginZoom)
    return () => {
      window.removeEventListener('resize', holdLoginZoom)
      document.body.style.zoom = Math.min(1.25, document.documentElement.clientWidth / 1372)
    }
  }, [])

  useEffect(() => () => {
    window.clearTimeout(coverageTimerRef.current)
    window.clearTimeout(navigationTimerRef.current)

    // When navigation has not happened, never leave a document-level transition sheet behind.
    if (!didNavigateRef.current) {
      const page = document.documentElement
      page.classList.remove('pairdesk-entry-closing', 'pairdesk-entry-covered')
      page.style.removeProperty('--pairdesk-entry-x')
      page.style.removeProperty('--pairdesk-entry-y')
    }
  }, [])

  function clearError(setter, value) {
    setter(value)
    if (error) setError('')
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (submittingRef.current) return

    if (!user.trim() || !pass) {
      setError('Enter your username and password to continue.')
      requestAnimationFrame(() => (user.trim() ? passRef.current : userRef.current)?.focus())
      return
    }

    if (!login(user, pass)) {
      setError('That username and password do not match.')
      return
    }

    submittingRef.current = true
    setError('')
    setBusy(true)

    const destination = location.state?.from ?? '/'
    destinationRef.current = destination

    // Use the artwork interval to fetch the real dashboard, but never delay navigation for it.
    if (destination.split(/[?#]/)[0] === '/') {
      queryClient.prefetchQuery({
        queryKey: ['dashboard'],
        queryFn: () => apiGet('/api/dashboard'),
      }).catch(() => {})
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || document.hidden) {
      didNavigateRef.current = true
      navigate(destination, { replace: true })
      return
    }

    setResolving(true)

    // The rail completes first; its actual rendered P&L endpoint then becomes the ledger seam.
    coverageTimerRef.current = window.setTimeout(() => {
      const endpoint = resultRef.current?.getBoundingClientRect()
      const page = document.documentElement
      const x = endpoint ? endpoint.left + endpoint.width / 2 : window.innerWidth * .72
      const y = endpoint ? endpoint.top + endpoint.height / 2 : window.innerHeight * .5

      page.style.setProperty('--pairdesk-entry-x', `${x}px`)
      page.style.setProperty('--pairdesk-entry-y', `${y}px`)
      page.classList.remove('pairdesk-entry-covered', 'pairdesk-entry-revealing')
      page.classList.add('pairdesk-entry-closing')

      navigationTimerRef.current = window.setTimeout(() => {
        if (didNavigateRef.current) return
        didNavigateRef.current = true
        page.classList.replace('pairdesk-entry-closing', 'pairdesk-entry-covered')
        navigate(destinationRef.current, {
          replace: true,
          state: { pairdeskEntry: 'login' },
        })
      }, 420)
    }, 840)
  }

  const desktopAutoFocus = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

  return (
    <div className={`login-screen${error ? ' has-error' : ''}${resolving ? ' is-resolving' : ''}`}>
      <section className="login-visual">
        <header className="login-brand">
          <img src="/logo.png" alt="Young Turtle" />
        </header>

        <div className="login-visual-mark">
          <CapitalRail resultRef={resultRef} />
          <div className="login-mobile-flow-key" aria-hidden="true">
            <span>Clients</span><i />
            <span>Capital</span><i />
            <span>Pair strategy</span><i />
            <span>P&amp;L</span>
          </div>
        </div>
      </section>

      <main className="login-panel">
        <div className="login-seam" aria-hidden="true"><span /><i /></div>
        <div className="login-panel-meta"><span>PRIVATE ACCESS</span><b>01</b></div>

        <form className="login-form" onSubmit={handleSubmit} aria-busy={busy} aria-labelledby="login-title" noValidate>
          <div className="login-product-name"><i />PAIRDESK</div>
          <h1 id="login-title">Sign in</h1>

          <div className="login-form-field">
            <label htmlFor="login-user">Username</label>
            <div className={`login-control${error ? ' has-error' : ''}`}>
              <span className="login-control-icon"><Icon name="user" /></span>
              <input
                ref={userRef}
                id="login-user"
                name="username"
                autoFocus={desktopAutoFocus}
                autoComplete="username"
                placeholder="admin"
                required
                disabled={busy}
                value={user}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                onChange={(event) => clearError(setUser, event.target.value)}
              />
            </div>
          </div>

          <div className="login-form-field">
            <label htmlFor="login-pass">Password</label>
            <div className={`login-control${error ? ' has-error' : ''}`}>
              <span className="login-control-icon"><Icon name="lock" /></span>
              <input
                ref={passRef}
                id="login-pass"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                disabled={busy}
                value={pass}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                onChange={(event) => clearError(setPass, event.target.value)}
              />
              <button
                className="login-password-toggle"
                type="button"
                disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                <Icon name="eye" />
                <span className={showPassword ? 'login-eye-strike is-visible' : 'login-eye-strike'} />
              </button>
            </div>
          </div>

          <button type="submit" className="login-submit" disabled={busy}>
            <span>{busy ? 'Opening PairDesk' : 'Enter PairDesk'}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 7l5 5-5 5" /></svg>
          </button>

          <div className={`login-feedback${error ? ' has-message' : ''}`} id="login-error" role={error ? 'alert' : undefined}>
            {error
              ? <><span aria-hidden="true">!</span>{error}</>
              : <><i aria-hidden="true" />{busy ? 'Resolving live book' : 'System ready'}</>}
          </div>

          <div className="login-status" aria-live="polite">{busy ? 'Access confirmed. Resolving your live book.' : ''}</div>
        </form>

        <footer className="login-panel-footer"><span>Young Turtle</span><i />PairDesk</footer>
      </main>
    </div>
  )
}
