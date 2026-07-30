# Login page — design variations

Numbered, isolated login concepts for the design bake-off. The **live** login remains
`web/src/pages/Login.jsx` + `web/src/pages/login.css`; the alternatives are available only through
temporary, lazy-loaded public preview routes:

- `/login-preview-2` — Matched Book
- `/login-preview-3` — Correlation Observatory
- `/login-preview-4` — Capital Folio

The preview modules are not part of the normal login/dashboard bundle until one of those URLs is
opened.

## How to switch the live version to a variant

```
cp web/src/pages/login-variants/vN-<name>.jsx  web/src/pages/Login.jsx
cp web/src/pages/login-variants/vN-<name>.css  web/src/pages/login.css
```
Then fix the two import lines at the top of the copied `Login.jsx`:
```
import { login } from '../auth'        (not '../../auth')
import { apiGet } from '../api/client' (not '../../api/client')
import './login.css'                   (not './vN-<name>.css')
```
Run `npx vite build` to confirm, then commit.

## Variants

### 1. Capital Rail (current live version)
- Files: `v1-capital-rail.jsx`, `v1-capital-rail.css`
- Split-screen layout: left panel is a dark navy canvas with an animated SVG diagram tracing
  client capital → pair strategy (NIFTY/MIDCAP legs) → account P&L; right panel is a light
  cream card with the sign-in form.
- Motion: the capital-flow diagram draws itself in on load; on successful login it "resolves" —
  the diagram collapses to its P&L endpoint, which becomes the seam for the app's ledger-reveal
  transition into the dashboard.
- Character: bold, product-storytelling, most visually distinctive of the set — makes the login
  page double as a one-glance explainer of what the platform does.

### 2. Matched Book

- Files: `v2-quiet-desk.jsx`, `v2-quiet-desk.css` (the legacy filenames are retained so existing
  preview bookmarks keep working).
- Layout: a full-width institutional execution ticket sits between upper and lower navy market
  fields. Sky long-book depth grows above it and orange hedge-book depth grows below it. This is a
  horizontal composition, not another left/right split.
- Motion: the ticket opens from its midpoint, both books build once, and their registration marks
  meet. Successful authentication flattens both books and closes them into one matched seam before
  the dashboard reveal.
- Character: precise, calm, execution-oriented. No fake balances, performance claims, particles,
  permanent animation, or expensive blur effects.

### 3. Correlation Observatory

- Files: `v3-correlation-observatory.jsx`, `v3-correlation-observatory.css`.
- Layout: one continuous midnight canvas. A large off-centre circular instrument contains paired
  sky/orange trajectories and a shared lock point; the compact sign-in form is printed directly on
  the lower-left field instead of living in a panel or card.
- Motion: the observatory calibrates once on arrival, the trajectories draw and register, then the
  scene becomes still. On success both trajectories resolve into the lock point, which becomes the
  origin of the dashboard reveal.
- Character: immersive and sculptural without becoming a neon trading HUD. It uses line, scale,
  negative space, and restrained color rather than glow, glass, or a simulated dashboard.

### 4. Capital Folio

- Files: `v4-capital-folio.jsx`, `v4-capital-folio.css`.
- Layout: a light, editorial canvas with the form anchored low on the left and a kinetic fan of
  managed-client ledger sheets dominating the centre/right. Block-like orange and sky strategy
  bands converge into a single result stamp.
- Motion: sheets arrive and fan like reports placed on a desk; strategy cells populate once. On
  success the client ledgers consolidate into one aligned book before the dashboard reveal. Fine
  pointer devices receive only a very shallow, bounded folio tilt.
- Character: tactile Swiss-editorial finance rather than a dark hero composition. It is the most
  physical and publication-like of the set.

All previews preserve the real authentication, dashboard prefetch, intended destination, keyboard
and screen-reader states, reduced-motion behavior, and the existing one-shot dashboard handoff.
