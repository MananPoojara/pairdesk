import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { login } from '../../auth'
import { apiGet } from '../../api/client'
import './v4-capital-folio.css'

const CELL_X = [92, 144, 196, 248, 300, 352, 404, 456, 508]
const ORANGE_Y = [142, 152, 164, 176, 188, 200, 210, 216, 220]
const SKY_Y = [300, 290, 278, 266, 254, 242, 232, 226, 222]

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

function BackLedger({ number }) {
  return (
    <article className={`cf-sheet cf-sheet-${number}`} aria-hidden="true">
      <span className="cf-sheet-tab">CLIENT {String(number).padStart(2, '0')}</span>
      <span className="cf-sheet-code">MANAGED BOOK / {String(number).padStart(2, '0')}</span>
      <span className="cf-sheet-ghost-line cf-ghost-a" />
      <span className="cf-sheet-ghost-line cf-ghost-b" />
      <span className="cf-sheet-ghost-line cf-ghost-c" />
      <i className="cf-edge cf-edge-orange" />
      <i className="cf-edge cf-edge-sky" />
    </article>
  )
}

function PairCells({ className, positions }) {
  return positions.map((y, index) => (
    <rect
      key={`${className}-${CELL_X[index]}`}
      className={`cf-pair-cell ${className}`}
      data-x={CELL_X[index]}
      data-y={y}
      x={CELL_X[index]}
      y={y}
      width={index > 6 ? 34 : 38}
      height="9"
      rx="1.5"
    />
  ))
}

function FrontLedger({ resultRef }) {
  return (
    <article className="cf-sheet cf-sheet-5 cf-front" aria-hidden="true">
      <span className="cf-sheet-tab">CLIENT 05</span>
      <div className="cf-front-heading cf-ledger-chrome">
        <span>PAIRDESK</span>
        <small>CONSOLIDATED LEDGER</small>
      </div>

      <svg className="cf-ledger" viewBox="0 0 720 460" preserveAspectRatio="none">
        <g className="cf-ledger-chrome">
          <path className="cf-ledger-frame" d="M40 94H680V377H40Z" />
          <path className="cf-ledger-rule" d="M40 122H680M72 94V377M40 336H680" />
          <path className="cf-ledger-grid" d="M40 166H680M40 210H680M40 254H680M40 298H680" />
          <text className="cf-ledger-label" x="40" y="78">CLIENT BOOKS</text>
          <text className="cf-ledger-label" x="286" y="78">PAIR ALLOCATION</text>
          <text className="cf-ledger-label" x="601" y="78">RESULT</text>
          <text className="cf-ledger-micro" x="49" y="149">01</text>
          <text className="cf-ledger-micro" x="49" y="193">02</text>
          <text className="cf-ledger-micro" x="49" y="237">03</text>
          <text className="cf-ledger-micro" x="49" y="281">04</text>
          <text className="cf-ledger-micro" x="49" y="325">05</text>
          <text className="cf-ledger-micro" x="48" y="358">ACTIVE</text>
          <text className="cf-ledger-micro" x="141" y="358">HEDGE</text>
          <text className="cf-ledger-micro" x="548" y="358">CONSOLIDATED</text>
          <rect className="cf-client-mark" x="89" y="140" width="52" height="6" rx="1" />
          <rect className="cf-client-mark" x="89" y="184" width="79" height="6" rx="1" />
          <rect className="cf-client-mark" x="89" y="228" width="61" height="6" rx="1" />
          <rect className="cf-client-mark" x="89" y="272" width="88" height="6" rx="1" />
          <rect className="cf-client-mark" x="89" y="316" width="69" height="6" rx="1" />
        </g>

        <g className="cf-pair-row cf-pair-orange">
          <PairCells className="is-orange" positions={ORANGE_Y} />
        </g>
        <g className="cf-pair-row cf-pair-sky">
          <PairCells className="is-sky" positions={SKY_Y} />
        </g>

        <g className="cf-result-bridge cf-ledger-chrome">
          <rect x="551" y="219" width="71" height="10" rx="1" />
          <rect x="616" y="197" width="5" height="54" rx="1" />
        </g>
        <g className="cf-pair-key cf-ledger-chrome">
          <rect className="is-orange" x="89" y="349" width="34" height="4" rx="1" />
          <rect className="is-sky" x="181" y="349" width="34" height="4" rx="1" />
        </g>
      </svg>

      <span ref={resultRef} className="cf-result-stamp">
        <small>ACCOUNT</small>
        <b>P&amp;L</b>
      </span>
      <i className="cf-edge cf-edge-orange" />
      <i className="cf-edge cf-edge-sky" />
    </article>
  )
}

function CapitalFolio({ resultRef }) {
  return (
    <figure className="cf-stage" aria-labelledby="cf-folio-caption">
      <div className="cf-perspective" aria-hidden="true">
        {[1, 2, 3, 4].map((number) => <BackLedger key={number} number={number} />)}
        <FrontLedger resultRef={resultRef} />
        <span className="cf-binding-pin" />
      </div>
      <figcaption id="cf-folio-caption" className="cf-caption">
        <span>05 managed books</span>
        <i />
        <span>01 consolidated result</span>
      </figcaption>
    </figure>
  )
}

export default function LoginPreviewV4() {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const rootRef = useRef(null)
  const resultRef = useRef(null)
  const userRef = useRef(null)
  const passRef = useRef(null)
  const submittingRef = useRef(false)
  const navigationTimerRef = useRef(null)
  const destinationRef = useRef('/')
  const didNavigateRef = useRef(false)
  const introContextRef = useRef(null)
  const pointerCleanupRef = useRef(() => {})
  const successContextRef = useRef(null)

  useLayoutEffect(() => {
    const holdLoginZoom = () => { document.body.style.zoom = '1' }
    holdLoginZoom()
    window.addEventListener('resize', holdLoginZoom)
    return () => {
      window.removeEventListener('resize', holdLoginZoom)
      document.body.style.zoom = Math.min(1.25, document.documentElement.clientWidth / 1372)
    }
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const stage = root.querySelector('.cf-stage')
    const perspective = root.querySelector('.cf-perspective')
    const finePointer = window.matchMedia('(pointer: fine) and (min-width: 901px)')
    let handlePointerMove
    let handlePointerLeave

    const context = gsap.context(() => {
      const animatedNodes = '.cf-sheet,.cf-pair-cell,.cf-auth-reveal'
      gsap.set(animatedNodes, { willChange: 'transform, opacity' })

      const timeline = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => gsap.set(animatedNodes, { clearProps: 'willChange' }),
      })

      timeline
        .from('.cf-header-rule', { scaleX: 0, duration: .52, transformOrigin: '0% 50%' }, 0)
        .from('.cf-logo,.cf-edition', { y: -9, autoAlpha: 0, duration: .42, stagger: .08 }, .08)
        .from('.cf-sheet', {
          x: 170,
          y: 92,
          z: -160,
          rotationZ: 12,
          autoAlpha: 0,
          duration: 1.02,
          stagger: .075,
          ease: 'expo.out',
        }, .08)
        .from('.cf-sheet-tab', { y: 18, autoAlpha: 0, duration: .42, stagger: .045 }, .48)
        .from('.cf-edge', {
          scaleX: 0,
          transformOrigin: '0% 50%',
          duration: .45,
          stagger: .025,
        }, .54)
        .from('.cf-ledger-chrome', { y: 5, autoAlpha: 0, duration: .38, stagger: .025 }, .62)
        .from('.cf-pair-cell', {
          scaleX: 0,
          autoAlpha: 0,
          transformOrigin: '0% 50%',
          duration: .25,
          stagger: .024,
          ease: 'power2.out',
        }, .66)
        .from('.cf-auth-reveal', {
          y: 18,
          autoAlpha: 0,
          duration: .48,
          stagger: .055,
        }, .78)
        .from('.cf-result-stamp', {
          scale: 1.28,
          rotation: -8,
          autoAlpha: 0,
          duration: .42,
          ease: 'back.out(1.65)',
        }, 1.04)
        .from('.cf-caption', { y: 8, autoAlpha: 0, duration: .35 }, 1.09)

      if (stage && perspective && finePointer.matches) {
        const rotateXTo = gsap.quickTo(perspective, 'rotationX', {
          duration: .65,
          ease: 'power3.out',
        })
        const rotateYTo = gsap.quickTo(perspective, 'rotationY', {
          duration: .65,
          ease: 'power3.out',
        })

        handlePointerMove = (event) => {
          if (root.classList.contains('is-resolving')) return
          const bounds = stage.getBoundingClientRect()
          const horizontal = ((event.clientX - bounds.left) / bounds.width) - .5
          const vertical = ((event.clientY - bounds.top) / bounds.height) - .5
          rotateXTo(10 - (vertical * 2.4))
          rotateYTo(-13 + (horizontal * 2.8))
        }
        handlePointerLeave = () => {
          rotateXTo(10)
          rotateYTo(-13)
        }

        stage.addEventListener('pointermove', handlePointerMove)
        stage.addEventListener('pointerleave', handlePointerLeave)
      }
    }, root)

    const cleanupPointer = () => {
      if (handlePointerMove) stage.removeEventListener('pointermove', handlePointerMove)
      if (handlePointerLeave) stage.removeEventListener('pointerleave', handlePointerLeave)
      if (perspective) gsap.killTweensOf(perspective)
    }
    introContextRef.current = context
    pointerCleanupRef.current = cleanupPointer

    return () => {
      cleanupPointer()
      pointerCleanupRef.current = () => {}
      if (introContextRef.current === context) introContextRef.current = null
      context.revert()
    }
  }, [])

  useEffect(() => () => {
    window.clearTimeout(navigationTimerRef.current)
    successContextRef.current?.revert()

    if (!didNavigateRef.current) {
      const page = document.documentElement
      page.classList.remove('pairdesk-entry-closing', 'pairdesk-entry-covered', 'pairdesk-entry-revealing')
      page.style.removeProperty('--pairdesk-entry-x')
      page.style.removeProperty('--pairdesk-entry-y')
    }
  }, [])

  function clearError(setter, value) {
    setter(value)
    if (error) setError('')
  }

  function startDashboardCover() {
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
    pointerCleanupRef.current()
    introContextRef.current?.revert()
    introContextRef.current = null
    successContextRef.current?.revert()
    successContextRef.current = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'power3.inOut' } })
      timeline
        .to('.cf-auth-reveal', {
          y: 18,
          autoAlpha: 0,
          duration: .22,
          stagger: { each: .025, from: 'end' },
        }, 0)
        .to('.cf-caption,.cf-edition', { autoAlpha: 0, duration: .2 }, 0)
        .to('.cf-sheet-tab,.cf-edge', {
          scaleX: 0,
          autoAlpha: 0,
          transformOrigin: '50% 50%',
          duration: .22,
          stagger: .012,
        }, .08)
        .to('.cf-sheet', {
          x: 0,
          y: 0,
          z: 0,
          rotationZ: 0,
          duration: .46,
          stagger: { each: .025, from: 'end' },
        }, .08)
        .to('.cf-pair-cell', {
          x: (_, element) => 548 - Number(element.dataset.x),
          y: (_, element) => 220 - Number(element.dataset.y),
          scaleX: .14,
          autoAlpha: .28,
          duration: .34,
          stagger: .008,
          ease: 'power3.in',
        }, .12)
        .to('.cf-result-stamp', {
          scale: 1.09,
          boxShadow: '0 14px 28px -16px rgba(16,42,66,.62)',
          duration: .2,
          ease: 'back.out(1.5)',
        }, .38)
        .add(startDashboardCover, .56)
    }, rootRef)
  }

  const desktopAutoFocus = typeof window !== 'undefined'
    && window.matchMedia('(pointer: fine)').matches

  return (
    <div
      ref={rootRef}
      className={`cf-screen${error ? ' has-error' : ''}${resolving ? ' is-resolving' : ''}`}
    >
      <div className="cf-paper-grain" aria-hidden="true" />

      <header className="cf-header">
        <span className="cf-header-rule" aria-hidden="true" />
        <img className="cf-logo" src="/logo.png" alt="Young Turtle" />
        <div className="cf-edition" aria-hidden="true">
          <span>PAIRDESK</span>
          <b>04</b>
        </div>
      </header>

      <main className="cf-layout">
        <section className="cf-auth">
          <div className="cf-auth-reveal cf-private-mark"><i />PRIVATE ACCESS</div>
          <h1 className="cf-auth-reveal" id="cf-login-title">Sign in</h1>

          <form
            className="cf-form"
            onSubmit={handleSubmit}
            aria-busy={busy}
            aria-labelledby="cf-login-title"
            noValidate
          >
            <div className="cf-auth-reveal cf-field">
              <label htmlFor="cf-user">Username</label>
              <div className={`cf-control${error ? ' has-error' : ''}`}>
                <span className="cf-control-icon"><Icon name="user" /></span>
                <input
                  ref={userRef}
                  id="cf-user"
                  name="username"
                  autoFocus={desktopAutoFocus}
                  autoComplete="username"
                  placeholder="admin"
                  required
                  disabled={busy}
                  value={user}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'cf-login-error' : undefined}
                  onChange={(event) => clearError(setUser, event.target.value)}
                />
              </div>
            </div>

            <div className="cf-auth-reveal cf-field">
              <label htmlFor="cf-pass">Password</label>
              <div className={`cf-control${error ? ' has-error' : ''}`}>
                <span className="cf-control-icon"><Icon name="lock" /></span>
                <input
                  ref={passRef}
                  id="cf-pass"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  disabled={busy}
                  value={pass}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'cf-login-error' : undefined}
                  onChange={(event) => clearError(setPass, event.target.value)}
                />
                <button
                  className="cf-password-toggle"
                  type="button"
                  disabled={busy}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  <Icon name="eye" />
                  <span className={showPassword ? 'cf-eye-strike is-visible' : 'cf-eye-strike'} />
                </button>
              </div>
            </div>

            <button type="submit" className="cf-auth-reveal cf-submit" disabled={busy}>
              <span>{busy ? 'Consolidating books' : 'Enter PairDesk'}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h13M13 7l5 5-5 5" />
              </svg>
            </button>

            <div
              className={`cf-auth-reveal cf-feedback${error ? ' has-message' : ''}`}
              id="cf-login-error"
              role={error ? 'alert' : undefined}
            >
              {error
                ? <><span aria-hidden="true">!</span>{error}</>
                : <><i aria-hidden="true" />{busy ? 'Access confirmed' : 'Secure session ready'}</>}
            </div>
            <span className="cf-status" aria-live="polite">
              {busy ? 'Access confirmed. Consolidating managed books.' : ''}
            </span>
          </form>
        </section>

        <CapitalFolio resultRef={resultRef} />
      </main>

      <div className="cf-registration" aria-hidden="true">
        <i className="cf-register cf-register-tl" />
        <i className="cf-register cf-register-tr" />
        <i className="cf-register cf-register-bl" />
        <i className="cf-register cf-register-br" />
      </div>
    </div>
  )
}
