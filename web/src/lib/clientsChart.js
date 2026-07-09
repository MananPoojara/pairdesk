// Clients-page equity curve geometry + heatmap + range filters — ported from mockups/clients.html.

// ── curve geometry (shared by draw + hover) ──────────────────────────
export function curveGeom(monthly) {
  const W = 800, H = 190, pad = 18
  const vals = monthly.map(m => m.cumulative_inr)
  const mn = Math.min(...vals), mx = Math.max(...vals)
  const range = mx - mn || 1
  const n = vals.length
  const xs = vals.map((_, i) => (n > 1 ? pad + i * (W - 2 * pad) / (n - 1) : W / 2))
  const inner = H - 2 * pad - 14
  const ys = vals.map(v => H - pad - 7 - (v - mn) / range * inner)
  return { W, H, pad, mn, mx, range, n, xs, ys, inner }
}

// Catmull-Rom → cubic bezier line + area fill + optional zero line
export function curvePaths(monthly) {
  if (!monthly || monthly.length < 2) return null
  const g = curveGeom(monthly)
  const { W, H, pad, mn, mx, range, n, xs, ys, inner } = g
  const seg = i => {
    const p0 = i > 0 ? [xs[i - 1], ys[i - 1]] : [xs[0], ys[0]]
    const p1 = [xs[i], ys[i]]
    const p2 = [xs[i + 1], ys[i + 1]]
    const p3 = i < n - 2 ? [xs[i + 2], ys[i + 2]] : [xs[n - 1], ys[n - 1]]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    return `C${c1x.toFixed(1)} ${c1y.toFixed(1)},${c2x.toFixed(1)} ${c2y.toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  let line = `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) line += ' ' + seg(i)
  const fill = line + ` L${xs[n - 1].toFixed(1)} ${H - pad} L${xs[0].toFixed(1)} ${H - pad} Z`
  let zeroY = null
  if (mn < 0 && mx > 0) zeroY = H - pad - 7 - (-mn) / range * inner
  const dots = xs.map((x, i) => ({
    x, y: ys[i], clr: monthly[i].net_inr >= 0 ? '#0EA5E9' : '#F97316',
    month: monthly[i].month, net: monthly[i].net_inr, cum: monthly[i].cumulative_inr,
  }))
  return { geom: g, line, fill, zeroY, dots }
}

// ── heatmap cell colour / ink / label ────────────────────────────────
export function cellClr(v) {
  if (v === null) return 'var(--soft)'
  if (v === 0) return '#F0E7D9'
  const sc = Math.min(Math.abs(v) / 5e6, 1)
  if (v > 0) return sc > 0.7 ? '#0EA5E9' : sc > 0.4 ? '#38BDF8' : sc > 0.15 ? '#7DD3FC' : '#BAE6FD'
  return sc > 0.7 ? '#EA580C' : sc > 0.4 ? '#F97316' : sc > 0.15 ? '#FDBA74' : '#FED7AA'
}
export function cellTxt(v) {
  if (v === null) return 'transparent'
  return Math.abs(v) / 5e6 > 0.4 ? '#fff' : '#0B2A45'
}
export function cellLbl(pct) {
  if (pct === null || pct === undefined) return ''
  return (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(2) + '%'
}

// ── range filter helpers ─────────────────────────────────────────────
const pad2 = n => (n < 10 ? '0' + n : '' + n)
export function getFromDate(rangeKey, monthly) {
  if (rangeKey === 'all' || !monthly.length) return null
  const last = monthly[monthly.length - 1].month
  const y = parseInt(last.slice(0, 4), 10), mo = parseInt(last.slice(5, 7), 10)
  let d
  if (rangeKey === '2y') { d = new Date(y, mo - 1 - 23, 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01' }
  if (rangeKey === '1y') { d = new Date(y, mo - 1 - 11, 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01' }
  if (rangeKey === 'ytd') return y + '-01-01'
  if (rangeKey === 'qtd') { const qs = Math.floor((mo - 1) / 3) * 3 + 1; return y + '-' + pad2(qs) + '-01' }
  return null
}
export function filterMonthly(monthly, rangeKey) {
  const from = getFromDate(rangeKey, monthly)
  const sl = from ? monthly.filter(m => m.month >= from) : monthly
  let cum = 0
  return sl.map(m => ({ ...m, cumulative_inr: (cum += m.net_inr) }))
}
export function filterTrades(trades, filtered) {
  if (!filtered.length) return []
  const fromMon = filtered[0].month.slice(0, 7)
  return trades.filter(t => t.date.slice(0, 7) >= fromMon)
}
export function computeStats(filtered, aumInr) {
  if (!filtered.length) return { net_inr: 0, return_pct: 0, gross_inr: 0, charges_inr: 0, sharpe: 0, win_rate: 0, wins: 0, total_months: 0, max_dd_pct: 0, best_month_inr: 0, worst_month_inr: 0 }
  const hasCapital = Number.isFinite(aumInr) && aumInr > 0
  const nets = filtered.map(m => m.net_inr)
  const cumArr = filtered.map(m => m.cumulative_inr)
  const totalNet = cumArr[cumArr.length - 1] || 0
  const wins = nets.filter(n => n > 0).length
  let sharpe = 0
  if (filtered.length >= 2 && hasCapital) {
    const pcts = nets.map(n => n / aumInr * 100)
    const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length
    const variance = pcts.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / (pcts.length - 1)
    const std = Math.sqrt(variance)
    sharpe = std === 0 ? 0 : +((mean / std * Math.sqrt(12)).toFixed(2))
  }
  let peak = 0, maxDD = 0
  cumArr.forEach(v => { if (v > peak) peak = v; const dd = peak === 0 ? 0 : (peak - v) / peak; if (dd > maxDD) maxDD = dd })
  return {
    net_inr: Math.round(totalNet),
    return_pct: hasCapital ? +(totalNet / aumInr * 100).toFixed(2) : 0,
    gross_inr: Math.round(filtered.reduce((s, m) => s + m.gross_inr, 0)),
    charges_inr: Math.round(filtered.reduce((s, m) => s + m.charges_inr, 0)),
    sharpe,
    win_rate: filtered.length ? +(wins / filtered.length * 100).toFixed(1) : 0,
    wins, total_months: filtered.length,
    max_dd_pct: +(maxDD * 100).toFixed(2),
    best_month_inr: Math.round(Math.max(...nets)),
    worst_month_inr: Math.round(Math.min(...nets)),
  }
}

export const RANGES = ['all', '2y', '1y', 'ytd', 'qtd']
export const RLBL = { all: 'All', '2y': '2Y', '1y': '1Y', ytd: 'YTD', qtd: 'QTD' }
export const RFULL = { all: 'All time', '2y': 'Last 2 years', '1y': 'Last 1 year', ytd: 'Year to date', qtd: 'Quarter to date' }
export const CAT_ORDER = ['Institution', 'HNI', 'Retail']
export const CAT_CLS = { Institution: 'inst', HNI: 'hni', Retail: 'retail' }
export const CAT_LBL = { Institution: 'INST', HNI: 'HNI', Retail: 'RETAIL' }
export const CAT_RANGE = { Institution: '>₹100 Cr', HNI: '₹10–100 Cr', Retail: '<₹10 Cr' }
