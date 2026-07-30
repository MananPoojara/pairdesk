import { createPortal } from 'react-dom'
import { fmtInr } from '../lib/format'
import { useEscClose } from '../lib/useEscClose'

const fInr = (n) => fmtInr(n).replace(/^\+/, '')

// Consolidated NIFTY-leg / MIDCAP-leg performance for a clicked heatmap cell (one month, or a quarter's
// 3 constituent months summed). Purely client-side — every field it needs (net_inr, nifty_net_inr,
// midcap_net_inr, pct, nifty_pct, midcap_pct) is already in the monthly rows the heatmap itself uses.
// Shared by every Monthly Net Returns heatmap instance (Dashboard, Strategies, Clients).
export default function LegPerformanceModal({ period, monthly, scaleInr, onClose }) {
  useEscClose(onClose)
  const rows = (monthly || []).filter(m => period.months.includes(String(m.month).slice(0, 7)))
  const title = period.plabel || (() => {
    try { return new Date(period.month + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
    catch { return period.month }
  })()
  const sum = key => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
  const scale = scaleInr || (n => n)
  const combinedNet = scale(sum('net_inr')), combinedPct = sum('pct')
  const niftyNet = scale(sum('nifty_net_inr')), niftyPct = sum('nifty_pct')
  const midcapNet = scale(sum('midcap_net_inr')), midcapPct = sum('midcap_pct')
  const leg = (label, net, pct) => (
    <div className="mc">
      <div className="l">{label}</div>
      <div className={'v ' + (pct >= 0 ? 'u' : 'd')}>{(pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'}</div>
      <div className={'v ' + (net >= 0 ? 'u' : 'd')} style={{ fontSize: '0.8125rem', marginTop: 3 }}>{fInr(net)}</div>
    </div>
  )
  return createPortal(
    // Portaled straight to <body> — this modal is opened from deep inside pages that use the .fu
    // entrance-animation class, and a CSS animation targeting `transform` (even at rest, held by
    // fill-mode) makes Chromium treat that ancestor as the containing block for `position:fixed`
    // descendants. Left in place, the overlay ends up pinned to that scrolled container instead of
    // the true viewport — portaling escapes the whole subtree so `position:fixed` means the viewport.
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose() }}>
      <div className="modal" style={{ maxWidth: 560, width: '95%' }}>
        <div className="mh"><b>{title}</b><span className="x" onClick={onClose}>×</span></div>
        <div style={{ padding: '18px 20px 20px' }}>
          {rows.length === 0 && <div className="crumb">No data for this period.</div>}
          {rows.length > 0 && <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {leg('Combined (pair)', combinedNet, combinedPct)}
              {leg('NIFTY leg', niftyNet, niftyPct)}
              {leg('MIDCAP leg', midcapNet, midcapPct)}
            </div>
            {period.quarter && (
              <div className="s" style={{ marginTop: 14, color: 'var(--muted)', fontWeight: 600, fontSize: '0.71875rem' }}>
                Sum of {period.months.length} months in {period.plabel}.
              </div>
            )}
          </>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
