import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import MotionPathPlugin from 'gsap/MotionPathPlugin'
import { login } from '../../auth'
import { apiGet } from '../../api/client'
import './v2-quiet-desk.css'

gsap.registerPlugin(MotionPathPlugin)

const UPPER_DEPTH = [
  42, 55, 66, 74, 96, 118, 107, 128, 151, 142, 168, 176, 151, 133,
  121, 136, 118, 98, 112, 91, 83, 67, 78, 60, 51, 43, 48, 36,
]

const LOWER_DEPTH = [
  34, 46, 57, 71, 86, 103, 119, 111, 136, 154, 146, 129, 143, 161,
  137, 116, 101, 111, 96, 82, 88, 72, 61, 69, 52, 44, 39, 31,
]

const UPPER_CONTOUR =
  'M0 223C118 221 168 204 236 189C318 171 359 119 450 128C534 137 572 87 660 97C746 107 779 143 866 139C953 134 996 166 1082 159C1170 152 1236 194 1301 184C1361 175 1394 192 1440 181'

const LOWER_CONTOUR =
  'M0 37C111 40 168 51 236 70C321 94 362 134 451 128C538 122 577 166 665 158C751 150 786 119 870 124C958 129 1000 97 1087 105C1175 113 1237 73 1303 82C1363 91 1395 75 1440 84'

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

function BookField({ side }) {
  const upper = side === 'upper'
  const depth = upper ? UPPER_DEPTH : LOWER_DEPTH
  const contour = upper ? UPPER_CONTOUR : LOWER_CONTOUR

  return (
    <section className={`mb-book mb-book--${side}`} aria-hidden="true">
      {upper && (
        <div className="mb-brand">
          <img src="/logo.png" alt="" />
        </div>
      )}

      <div className="mb-book-label">
        <i />
        <span>{upper ? 'Long book' : 'Hedge book'}</span>
        <b>{upper ? 'A' : 'B'}</b>
      </div>

      <svg
        className="mb-book-art"
        viewBox="0 0 1440 260"
        preserveAspectRatio="none"
        focusable="false"
      >
        <g className="mb-grid">
          <path d="M0 52H1440M0 104H1440M0 156H1440M0 208H1440" />
          <path d="M120 0V260M240 0V260M360 0V260M480 0V260M600 0V260M720 0V260M840 0V260M960 0V260M1080 0V260M1200 0V260M1320 0V260" />
        </g>

        <g className="mb-depth">
          {depth.map((height, index) => (
            <rect
              // This is a fixed art-directed profile, not generated market data.
              key={`${side}-${index}`}
              className="mb-fin"
              x={45 + index * 50}
              y={upper ? 260 - height : 0}
              width="7"
              height={height}
            />
          ))}
        </g>

        <path className="mb-contour-shadow" d={contour} />
        <path className="mb-contour-guide" d={contour} />
        <path className="mb-contour" pathLength="1" d={contour} />
        <circle className="mb-order-marker" cx="0" cy="0" r="4.5" />

        <g className="mb-register-ticks">
          <path d={upper ? 'M1368 174v54M1358 228h20' : 'M1368 32v54M1358 32h20'} />
          <rect x="1363.5" y={upper ? 169.5 : 81.5} width="9" height="9" />
        </g>
      </svg>
    </section>
  )
}

export default function LoginPreviewV2() {
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
  const registerRef = useRef(null)
  const userRef = useRef(null)
  const passRef = useRef(null)
  const introContextRef = useRef(null)
  const resolveContextRef = useRef(null)
  const submittingRef = useRef(false)
  const didNavigateRef = useRef(false)

  useLayoutEffect(() => {
    const holdZoom = () => {
      document.body.style.zoom = '1'
    }

    holdZoom()
    window.addEventListener('resize', holdZoom)
    return () => {
      window.removeEventListener('resize', holdZoom)
      document.body.style.zoom = Math.min(1.25, document.documentElement.clientWidth / 1372)
    }
  }, [])

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const root = rootRef.current
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })

      timeline
        .from('.mb-ticket', {
          clipPath: 'inset(0 50% 0 50%)',
          duration: 0.72,
          ease: 'power4.inOut',
        })
        .from(
          '.mb-book--upper .mb-fin',
          {
            scaleY: 0,
            transformOrigin: 'center bottom',
            duration: 0.62,
            stagger: { each: 0.018, from: 'center' },
          },
          0.12,
        )
        .from(
          '.mb-book--lower .mb-fin',
          {
            scaleY: 0,
            transformOrigin: 'center top',
            duration: 0.62,
            stagger: { each: 0.018, from: 'center' },
          },
          0.18,
        )
        .fromTo(
          '.mb-contour',
          { strokeDashoffset: 1 },
          { strokeDashoffset: 0, duration: 0.92, ease: 'power2.inOut' },
          0.31,
        )
        .from(
          '.mb-brand, .mb-book-label',
          { autoAlpha: 0, y: (index) => (index === 0 ? -8 : 8), duration: 0.42, stagger: 0.06 },
          0.44,
        )
        .from(
          '.mb-form-heading, .mb-field, .mb-action, .mb-feedback',
          { autoAlpha: 0, y: 9, duration: 0.4, stagger: 0.055 },
          0.5,
        )
        .from(
          '.mb-register-leg',
          { autoAlpha: 0, scale: 0.4, duration: 0.32, stagger: 0.08 },
          0.58,
        )

      root.querySelectorAll('.mb-book').forEach((book, index) => {
        const marker = book.querySelector('.mb-order-marker')
        const guide = book.querySelector('.mb-contour-guide')

        timeline
          .fromTo(marker, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12 }, 0.53 + index * 0.07)
          .to(
            marker,
            {
              motionPath: {
                path: guide,
                align: guide,
                alignOrigin: [0.5, 0.5],
                start: 0.015,
                end: 0.945,
              },
              duration: 0.94,
              ease: 'power2.inOut',
            },
            0.55 + index * 0.07,
          )
          .to(marker, { autoAlpha: 0, duration: 0.18 }, 1.41 + index * 0.07)
      })
    }, root)

    introContextRef.current = context
    return () => {
      context.revert()
      if (introContextRef.current === context) introContextRef.current = null
    }
  }, [])

  useEffect(
    () => () => {
      resolveContextRef.current?.revert()

      if (!didNavigateRef.current) {
        const page = document.documentElement
        page.classList.remove(
          'pairdesk-entry-closing',
          'pairdesk-entry-covered',
          'pairdesk-entry-revealing',
        )
        page.style.removeProperty('--pairdesk-entry-x')
        page.style.removeProperty('--pairdesk-entry-y')
      }
    },
    [],
  )

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
    if (destination.split(/[?#]/)[0] === '/') {
      queryClient
        .prefetchQuery({
          queryKey: ['dashboard'],
          queryFn: () => apiGet('/api/dashboard'),
        })
        .catch(() => {})
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || document.hidden) {
      didNavigateRef.current = true
      navigate(destination, { replace: true })
      return
    }

    // A quick submit can happen while the entrance is still resolving. Revert that scoped
    // context to the CSS-final state before the success timeline takes ownership of the same nodes.
    introContextRef.current?.revert()
    introContextRef.current = null
    setResolving(true)

    const root = rootRef.current
    const registerRect = registerRef.current?.getBoundingClientRect()
    const origin = {
      x: registerRect ? registerRect.left + registerRect.width / 2 : window.innerWidth * 0.95,
      y: registerRect ? registerRect.top + registerRect.height / 2 : window.innerHeight * 0.5,
    }

    const context = gsap.context(() => {
      const ticket = root.querySelector('.mb-ticket')
      const ticketHeight = ticket.getBoundingClientRect().height

      gsap
        .timeline({ defaults: { ease: 'power3.inOut' } })
        .to('.mb-form, .mb-brand, .mb-book-label', { autoAlpha: 0, y: -6, duration: 0.24 }, 0)
        .to(
          '.mb-fin',
          {
            scaleY: 0.025,
            duration: 0.42,
            stagger: { amount: 0.16, from: 'center' },
          },
          0.04,
        )
        .to('.mb-contour', { strokeDashoffset: -1, duration: 0.48 }, 0.06)
        .to('.mb-register-leg.is-sky', { y: 0, duration: 0.38 }, 0.17)
        .to('.mb-register-leg.is-orange', { y: 0, duration: 0.38 }, 0.17)
        .to('.mb-ticket', { scaleY: 0.014, transformOrigin: 'center', duration: 0.42 }, 0.38)
        .to('.mb-book--upper', { y: ticketHeight / 2, duration: 0.42 }, 0.4)
        .to('.mb-book--lower', { y: -ticketHeight / 2, duration: 0.42 }, 0.4)
        .to('.mb-register-core', { autoAlpha: 1, scale: 1.45, duration: 0.24 }, 0.44)
        .add(() => {
          const page = document.documentElement
          page.style.setProperty('--pairdesk-entry-x', `${origin.x}px`)
          page.style.setProperty('--pairdesk-entry-y', `${origin.y}px`)
          page.classList.remove('pairdesk-entry-covered', 'pairdesk-entry-revealing')
          page.classList.add('pairdesk-entry-closing')
        }, 0.7)
        .add(() => {
          didNavigateRef.current = true
          document.documentElement.classList.replace(
            'pairdesk-entry-closing',
            'pairdesk-entry-covered',
          )
          navigate(destination, {
            replace: true,
            state: { pairdeskEntry: 'login' },
          })
        }, 1.12)
    }, root)

    resolveContextRef.current = context
  }

  const desktopAutoFocus =
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

  return (
    <div
      ref={rootRef}
      className={`mb-screen${error ? ' has-error' : ''}${resolving ? ' is-resolving' : ''}`}
    >
      <BookField side="upper" />

      <main className="mb-ticket">
        <div className="mb-ticket-rule is-sky" aria-hidden="true" />
        <div className="mb-ticket-rule is-orange" aria-hidden="true" />

        <div ref={registerRef} className="mb-register" aria-hidden="true">
          <span className="mb-register-leg is-sky"><i /></span>
          <b className="mb-register-core" />
          <span className="mb-register-leg is-orange"><i /></span>
        </div>

        <form
          className="mb-form"
          onSubmit={handleSubmit}
          aria-busy={busy}
          aria-labelledby="mb-title"
          noValidate
        >
          <header className="mb-form-heading">
            <div className="mb-product-name"><i />PairDesk</div>
            <h1 id="mb-title">Sign in</h1>
            <span>Private access</span>
          </header>

          <div className="mb-field">
            <label htmlFor="mb-user">Username</label>
            <div className={`mb-control${error ? ' has-error' : ''}`}>
              <span className="mb-control-icon"><Icon name="user" /></span>
              <input
                ref={userRef}
                id="mb-user"
                name="username"
                autoFocus={desktopAutoFocus}
                autoComplete="username"
                placeholder="admin"
                required
                disabled={busy}
                value={user}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'mb-error' : undefined}
                onChange={(event) => clearError(setUser, event.target.value)}
              />
            </div>
          </div>

          <div className="mb-field">
            <label htmlFor="mb-pass">Password</label>
            <div className={`mb-control${error ? ' has-error' : ''}`}>
              <span className="mb-control-icon"><Icon name="lock" /></span>
              <input
                ref={passRef}
                id="mb-pass"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                disabled={busy}
                value={pass}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'mb-error' : undefined}
                onChange={(event) => clearError(setPass, event.target.value)}
              />
              <button
                className="mb-eye"
                type="button"
                disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                <Icon name="eye" />
                <span className={showPassword ? 'mb-eye-strike is-visible' : 'mb-eye-strike'} />
              </button>
            </div>
          </div>

          <div className="mb-action">
            <span>Matched-book access</span>
            <button type="submit" className="mb-submit" disabled={busy}>
              <span>{busy ? 'Matching' : 'Sign in'}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h13M13 7l5 5-5 5" />
              </svg>
            </button>
          </div>

          <div
            id="mb-error"
            className={`mb-feedback${error ? ' has-message' : ''}`}
            role={error ? 'alert' : 'status'}
            aria-live="polite"
          >
            {error ? <><span>!</span>{error}</> : <><i />Secure desk</>}
          </div>
        </form>

        <div className="mb-screen-reader-status" aria-live="polite">
          {resolving ? 'Credentials accepted. Opening PairDesk.' : ''}
        </div>
      </main>

      <BookField side="lower" />
    </div>
  )
}
