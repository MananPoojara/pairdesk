import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { login } from '../../auth'
import { apiGet } from '../../api/client'
import './v3-correlation-observatory.css'

const REGISTRATION_TICKS = Array.from({ length: 48 }, (_, index) => ({
  angle: index * 7.5,
  major: index % 6 === 0,
}))

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.75 12s3-5.25 8.25-5.25S20.25 12 20.25 12 17.25 17.25 12 17.25 3.75 12 3.75 12Z" />
      <circle cx="12" cy="12" r="2.25" />
    </svg>
  )
}

function CorrelationObservatory({ lockRef }) {
  return (
    <svg
      className="co-instrument"
      viewBox="0 0 800 800"
      role="img"
      aria-labelledby="co-observatory-title co-observatory-description"
    >
      <title id="co-observatory-title">Pair correlation observatory</title>
      <desc id="co-observatory-description">
        Two market trajectories calibrate against concentric registration rings and meet at one correlation point.
      </desc>

      <g className="co-ring-stack">
        <circle className="co-ring co-ring-boundary" cx="400" cy="400" r="306" />
        <circle className="co-ring co-ring-index" cx="400" cy="400" r="276" />

        <g className="co-registration-ticks">
          {REGISTRATION_TICKS.map(({ angle, major }) => (
            <line
              key={angle}
              className={major ? 'co-registration-tick is-major' : 'co-registration-tick'}
              x1="400"
              y1={major ? '92' : '99'}
              x2="400"
              y2="109"
              transform={`rotate(${angle} 400 400)`}
            />
          ))}
        </g>

        <g className="co-ring-mask co-ring-mask-outer">
          <path d="M172 238A298 298 0 0 1 619 230" />
          <path d="M646 555A298 298 0 0 1 219 611" />
        </g>

        <circle className="co-ring co-ring-orbit co-ring-orbit-a" cx="400" cy="400" r="232" />
        <circle className="co-ring co-ring-orbit co-ring-orbit-b" cx="400" cy="400" r="176" />
        <circle className="co-ring co-ring-orbit co-ring-orbit-c" cx="400" cy="400" r="118" />

        <g className="co-ring-mask co-ring-mask-inner">
          <path d="M292 276A164 164 0 0 1 533 291" />
          <path d="M540 492A164 164 0 0 1 277 501" />
        </g>

        <g className="co-crosshair">
          <path d="M400 112V688M112 400H688" />
          <path d="M400 369v62M369 400h62" />
        </g>

        <g className="co-registration-corners">
          <path d="M177 206h-30v30M623 206h30v30M177 594h-30v-30M623 594h30v-30" />
        </g>
      </g>

      <g className="co-trajectory-field">
        <path
          className="co-trajectory co-trajectory-sky"
          pathLength="1"
          d="M119 548C205 516 176 303 318 260C405 234 419 307 480 350"
        />
        <path
          className="co-trajectory co-trajectory-orange"
          pathLength="1"
          d="M704 587C596 616 633 437 564 412C516 395 514 366 480 350"
        />

        <g className="co-origin-node co-origin-node-sky">
          <circle cx="119" cy="548" r="8" />
          <path d="M98 548h12M128 548h12M119 527v12M119 557v12" />
        </g>
        <g className="co-origin-node co-origin-node-orange">
          <circle cx="704" cy="587" r="8" />
          <path d="M683 587h12M713 587h12M704 566v12M704 596v12" />
        </g>

        <circle className="co-travel-node co-travel-node-sky" cx="480" cy="350" r="5" />
        <circle className="co-travel-node co-travel-node-orange" cx="480" cy="350" r="5" />

        <g ref={lockRef} className="co-correlation-lock">
          <circle className="co-lock-register" cx="480" cy="350" r="19" />
          <path className="co-lock-cross" d="M480 322v14M480 364v14M452 350h14M494 350h14" />
          <path className="co-lock-core" d="m480 342 8 8-8 8-8-8Z" />
        </g>
      </g>
    </svg>
  )
}

export default function CorrelationObservatoryLogin() {
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
  const lockRef = useRef(null)
  const userRef = useRef(null)
  const passRef = useRef(null)
  const submittingRef = useRef(false)
  const introTimelineRef = useRef(null)
  const resolveTimelineRef = useRef(null)
  const didNavigateRef = useRef(false)

  useLayoutEffect(() => {
    const holdPreviewZoom = () => {
      document.body.style.zoom = '1'
    }

    holdPreviewZoom()
    window.addEventListener('resize', holdPreviewZoom)
    return () => {
      window.removeEventListener('resize', holdPreviewZoom)
      document.body.style.zoom = Math.min(1.25, document.documentElement.clientWidth / 1372)
    }
  }, [])

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const context = gsap.context(() => {
      introTimelineRef.current = gsap.timeline({
        defaults: { ease: 'power2.out' },
      })
        .from('.co-brand', { autoAlpha: 0, y: -8, duration: 0.4 }, 0)
        .from('.co-access-mark', { autoAlpha: 0, y: -6, duration: 0.34 }, 0.08)
        .from('.co-ring-stack', {
          autoAlpha: 0,
          scale: 0.965,
          duration: 0.58,
          transformOrigin: '50% 50%',
        }, 0.03)
        .from('.co-ring-index', {
          rotation: -17,
          duration: 0.82,
          transformOrigin: '50% 50%',
          ease: 'power3.out',
        }, 0.08)
        .from('.co-ring-mask-outer', {
          rotation: 28,
          duration: 0.92,
          transformOrigin: '50% 50%',
          ease: 'power3.out',
        }, 0.08)
        .from('.co-ring-mask-inner', {
          rotation: -38,
          duration: 0.88,
          transformOrigin: '50% 50%',
          ease: 'power3.out',
        }, 0.13)
        .from('.co-registration-tick', {
          autoAlpha: 0,
          duration: 0.18,
          stagger: { amount: 0.42, from: 'center' },
        }, 0.08)
        .fromTo(
          '.co-trajectory',
          { strokeDashoffset: 1 },
          {
            strokeDashoffset: 0,
            duration: 0.9,
            stagger: 0.09,
            ease: 'power2.inOut',
          },
          0.3,
        )
        .from('.co-origin-node', { autoAlpha: 0, scale: 0.5, duration: 0.3, stagger: 0.08 }, 0.36)
        .fromTo(
          '.co-travel-node-sky',
          { autoAlpha: 0, x: -46, y: -38 },
          { autoAlpha: 1, x: 0, y: 0, duration: 0.48, ease: 'power3.inOut' },
          0.91,
        )
        .fromTo(
          '.co-travel-node-orange',
          { autoAlpha: 0, x: 48, y: 41 },
          { autoAlpha: 1, x: 0, y: 0, duration: 0.48, ease: 'power3.inOut' },
          0.96,
        )
        .to('.co-travel-node', { autoAlpha: 0, duration: 0.13 }, 1.38)
        .from('.co-correlation-lock', {
          autoAlpha: 0,
          scale: 0.35,
          duration: 0.34,
          transformOrigin: '50% 50%',
          ease: 'back.out(1.8)',
        }, 1.28)
        .from('.co-form-piece', {
          autoAlpha: 0,
          y: 12,
          duration: 0.38,
          stagger: 0.065,
        }, 0.48)
    }, rootRef)

    return () => {
      introTimelineRef.current = null
      context.revert()
    }
  }, [])

  useEffect(() => () => {
    resolveTimelineRef.current?.kill()

    if (!didNavigateRef.current) {
      const page = document.documentElement
      page.classList.remove(
        'pairdesk-entry-closing',
        'pairdesk-entry-covered',
        'pairdesk-entry-revealing',
      )
      page.style.removeProperty('--pairdesk-entry-x')
      page.style.removeProperty('--pairdesk-entry-y')
      page.style.removeProperty('--pairdesk-entry-header-y')
    }
  }, [])

  function clearError(setter, value) {
    setter(value)
    if (error) setError('')
  }

  function navigateWithoutArtwork(destination) {
    didNavigateRef.current = true
    navigate(destination, { replace: true })
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
      requestAnimationFrame(() => passRef.current?.focus())
      return
    }

    submittingRef.current = true
    setError('')
    setBusy(true)

    const destination = location.state?.from ?? '/'
    if (destination.split(/[?#]/)[0] === '/') {
      queryClient.prefetchQuery({
        queryKey: ['dashboard'],
        queryFn: () => apiGet('/api/dashboard'),
      }).catch(() => {})
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || document.hidden) {
      navigateWithoutArtwork(destination)
      return
    }

    introTimelineRef.current?.kill()
    setResolving(true)

    const root = rootRef.current
    resolveTimelineRef.current = gsap.timeline({ defaults: { ease: 'power2.inOut' } })
      .to(root.querySelector('.co-form'), { autoAlpha: 0, x: -12, duration: 0.28 }, 0)
      .to(root.querySelector('.co-header'), { autoAlpha: 0, y: -7, duration: 0.24 }, 0)
      .to(root.querySelector('.co-ring-stack'), {
        rotation: 20,
        scale: 0.68,
        autoAlpha: 0.12,
        duration: 0.62,
        transformOrigin: '50% 50%',
        ease: 'power3.in',
      }, 0)
      .to(root.querySelector('.co-trajectory-sky'), {
        rotation: 82,
        scale: 0.035,
        autoAlpha: 0.35,
        duration: 0.62,
        svgOrigin: '480 350',
        ease: 'power3.in',
      }, 0.05)
      .to(root.querySelector('.co-trajectory-orange'), {
        rotation: -82,
        scale: 0.035,
        autoAlpha: 0.35,
        duration: 0.62,
        svgOrigin: '480 350',
        ease: 'power3.in',
      }, 0.05)
      .to(root.querySelectorAll('.co-origin-node'), {
        autoAlpha: 0,
        scale: 0.5,
        duration: 0.28,
      }, 0.08)
      .to(root.querySelector('.co-correlation-lock'), {
        rotation: 45,
        scale: 1.35,
        duration: 0.28,
        transformOrigin: '50% 50%',
        ease: 'back.out(2)',
      }, 0.5)
      .add(() => {
        const lock = lockRef.current?.getBoundingClientRect()
        const page = document.documentElement
        const x = lock ? lock.left + lock.width / 2 : window.innerWidth * 0.72
        const y = lock ? lock.top + lock.height / 2 : window.innerHeight * 0.45

        page.style.setProperty('--pairdesk-entry-x', `${x}px`)
        page.style.setProperty('--pairdesk-entry-y', `${y}px`)
        page.classList.remove('pairdesk-entry-covered', 'pairdesk-entry-revealing')
        page.classList.add('pairdesk-entry-closing')
      }, 0.72)
      .add(() => {
        if (didNavigateRef.current) return
        didNavigateRef.current = true
        document.documentElement.classList.replace(
          'pairdesk-entry-closing',
          'pairdesk-entry-covered',
        )
        navigate(destination, {
          replace: true,
          state: { pairdeskEntry: 'login' },
        })
      }, 1.14)
  }

  const desktopAutoFocus = typeof window !== 'undefined'
    && window.matchMedia('(pointer: fine)').matches

  return (
    <div
      ref={rootRef}
      className={`co-screen${error ? ' has-error' : ''}${resolving ? ' is-resolving' : ''}`}
    >
      <header className="co-header">
        <img className="co-brand" src="/logo.png" alt="Young Turtle" />
        <div className="co-access-mark"><i aria-hidden="true" />PRIVATE ACCESS</div>
      </header>

      <section className="co-observatory">
        <CorrelationObservatory lockRef={lockRef} />
      </section>

      <main className="co-login-region">
        <form
          className="co-form"
          onSubmit={handleSubmit}
          aria-busy={busy}
          aria-labelledby="co-login-title"
          noValidate
        >
          <h1 id="co-login-title" className="co-form-piece">Sign in</h1>

          <div className="co-field co-form-piece">
            <label htmlFor="co-user">Username</label>
            <input
              ref={userRef}
              id="co-user"
              name="username"
              autoFocus={desktopAutoFocus}
              autoComplete="username"
              placeholder="admin"
              required
              disabled={busy}
              value={user}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'co-login-error' : undefined}
              onChange={(inputEvent) => clearError(setUser, inputEvent.target.value)}
            />
          </div>

          <div className="co-field co-form-piece">
            <label htmlFor="co-pass">Password</label>
            <div className="co-password-control">
              <input
                ref={passRef}
                id="co-pass"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                disabled={busy}
                value={pass}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'co-login-error' : undefined}
                onChange={(inputEvent) => clearError(setPass, inputEvent.target.value)}
              />
              <button
                className="co-password-toggle"
                type="button"
                disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                <EyeIcon />
                <span className={showPassword ? 'co-eye-strike is-visible' : 'co-eye-strike'} />
              </button>
            </div>
          </div>

          <button className="co-submit co-form-piece" type="submit" disabled={busy}>
            <span>{busy ? 'Opening' : 'Sign in'}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 7l5 5-5 5" />
            </svg>
          </button>

          <div
            id="co-login-error"
            className={`co-feedback co-form-piece${error ? ' has-message' : ''}`}
            role={error ? 'alert' : undefined}
          >
            {error}
          </div>
        </form>
      </main>
    </div>
  )
}
