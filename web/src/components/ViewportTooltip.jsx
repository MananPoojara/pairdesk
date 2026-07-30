import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './viewport-tooltip.css'

const GAP = 10
const EDGE = 10

// The app applies a fit-to-width `document.body.style.zoom` (main.jsx) so the dashboard fits any
// window width. `anchor` comes from getBoundingClientRect() on the hovered element, which always
// reports true/visual screen pixels — but this surface's own `left`/`top` CSS values are set on an
// element that (per the app's zoom setup) ends up rendered through that same zoom, so a raw style
// pixel here is NOT one true screen pixel. Deriving the local scale factor from this element's own
// offsetWidth vs. its rendered (true) width lets every calculation below stay in "style pixels"
// consistently, whatever that scale happens to be.
function positionSurface(anchor, element) {
  const trueWidth = element.getBoundingClientRect().width
  const factor = element.offsetWidth ? trueWidth / element.offsetWidth : 1
  const width = element.offsetWidth
  const height = element.offsetHeight
  const aLeft = anchor.left / factor, aWidth = anchor.width / factor
  const aTop = anchor.top / factor, aBottom = anchor.bottom / factor
  const winW = window.innerWidth / factor, winH = window.innerHeight / factor
  const rawX = aLeft + aWidth / 2 - width / 2
  const left = Math.max(EDGE, Math.min(winW - width - EDGE, rawX))
  const roomAbove = aTop - GAP
  const top = roomAbove >= height + EDGE
    ? roomAbove - height
    : Math.min(winH - height - EDGE, aBottom + GAP)
  return { left, top: Math.max(EDGE, top) }
}

function TooltipSurface({ anchor, children, className = '' }) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: -9999, top: -9999 })

  useLayoutEffect(() => {
    if (!ref.current || !anchor) return
    setPosition(positionSurface(anchor, ref.current))
  }, [anchor, children])

  if (!anchor) return null
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={`viewport-tooltip ${className}`}
      style={position}
    >
      {children}
    </div>,
    document.body,
  )
}

export function FloatingTooltip({ x, y, children, className }) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return (
    <TooltipSurface anchor={{ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }} className={className}>
      {children}
    </TooltipSurface>
  )
}

function rectOf(el) {
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
}

export default function ViewportTooltip() {
  const [active, setActive] = useState(null)
  const targetRef = useRef(null)   // the DOM element currently anchoring the tooltip, if any

  useEffect(() => {
    const findTarget = node => node instanceof Element ? node.closest('[data-tooltip]') : null
    const show = event => {
      const target = findTarget(event.target)
      const text = target?.getAttribute('data-tooltip')
      if (!target || !text) return
      targetRef.current = target
      setActive({ text, anchor: rectOf(target) })
    }
    const hide = event => {
      const from = findTarget(event.target)
      if (!from) return
      const to = findTarget(event.relatedTarget)
      if (to === from) return
      // A hover-triggered layout shift (e.g. a scale transform on the target, or the browser bringing
      // it into view) can make the browser re-run hit-testing and fire a spurious pointerout with a
      // stale/empty relatedTarget even though the pointer is still physically over the same element.
      // Re-check the real point before hiding.
      if (findTarget(document.elementFromPoint(event.clientX, event.clientY)) === from) return
      targetRef.current = null
      setActive(null)
    }
    // Scrolling (e.g. the browser bringing a just-hovered element into view) shouldn't blindly dismiss
    // the tooltip — the anchor just moved, not away. Reposition to the target's new rect, and only
    // clear once it's actually left the DOM.
    const reposition = () => {
      const el = targetRef.current
      if (!el || !el.isConnected) { targetRef.current = null; setActive(null); return }
      setActive(a => a && { ...a, anchor: rectOf(el) })
    }
    document.addEventListener('pointerover', show)
    document.addEventListener('pointerout', hide)
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', hide)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerover', show)
      document.removeEventListener('pointerout', hide)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', hide)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [])

  return <TooltipSurface anchor={active?.anchor}>{active?.text}</TooltipSurface>
}
