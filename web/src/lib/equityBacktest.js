export function dateMs(date) {
  return new Date(String(date || '').slice(0, 10) + 'T00:00:00Z').getTime()
}

export function equityDomain(startDate, endDate, rows) {
  const first = rows?.[0]?.month || startDate
  const last = endDate || rows?.[rows.length - 1]?.month || first
  const start = dateMs(startDate || first)
  const end = Math.max(start + 86400000, dateMs(last))
  return { start, end }
}

export function equityValueDomain(liveRows, backtestRows) {
  const values = [0, ...liveRows.map(row => row.value), ...backtestRows.map(row => row.value)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return { min: min - 1, max: max + 1 }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

export function projectPoint(row, domain, valueDomain, width, height, pad) {
  const xRange = domain.end - domain.start || 1
  const yRange = valueDomain.max - valueDomain.min || 1
  return {
    x: pad + (dateMs(row.date) - domain.start) / xRange * (width - pad * 2),
    y: height - pad - (row.value - valueDomain.min) / yRange * (height - pad * 2),
  }
}

export function dateLinePoints(rows, domain, valueDomain, width, height, pad) {
  return (rows || []).map(row => projectPoint(row, domain, valueDomain, width, height, pad))
}

export function pathFromPoints(pts, height) {
  if (!pts.length) return { line: `M0,${height} L0,${height}`, fill: `M0,${height} L0,${height} Z` }
  if (pts.length === 1) {
    const p = pts[0]
    return { line: `M${p.x},${p.y}`, fill: `M${p.x},${p.y} L${p.x},${height} Z` }
  }
  const cr = (p0, p1, p2, p3) =>
    `C ${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ` +
    `${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i]
    const p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    d += ' ' + cr(p0, p1, p2, p3)
  }
  const last = pts[pts.length - 1], first = pts[0]
  return { line: d, fill: `${d} L${last.x},${height} L${first.x},${height} Z` }
}

export function buildDateCurvePath(rows, domain, valueDomain, width, height, pad) {
  return pathFromPoints(dateLinePoints(rows, domain, valueDomain, width, height, pad), height)
}

// The spot backtest sheet is sized to a 30 Cr base; rescale it to whatever AUM/allocation
// the chart is showing. Must match SPOT_BACKTEST_BASE_AUM_CR in server/src/data/spotBacktest.js.
const SPOT_BACKTEST_BASE_AUM_CR = 30

export function buildBacktestRows(series, domain, aumCr) {
  const rows = (series || []).filter(row => {
    const t = dateMs(row.date)
    return t >= domain.start && t <= domain.end
  })
  if (!rows.length) return []
  const scale = (Number(aumCr) || 0) / SPOT_BACKTEST_BASE_AUM_CR
  // Cumulate monthly spot net across the selected window so the backtest line re-zeros
  // per date range exactly like the live equity curve.
  let cum = 0
  return rows.map(row => {
    cum += Number(row.net_inr) || 0
    return { date: row.date, value: cum * scale }
  })
}

export function monthShort(date) {
  const d = new Date(String(date || '').slice(0, 10) + 'T00:00:00Z')
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(d.getUTCFullYear()).slice(2)}`
}

export function timelineTicks(domain, rows, maxTicks = 6) {
  const visible = (rows || []).filter(row => {
    const t = dateMs(row.month)
    return t >= domain.start && t <= domain.end
  })
  if (!visible.length) return []
  const target = Math.min(maxTicks, visible.length)
  const step = Math.max(1, Math.ceil((visible.length - 1) / Math.max(1, target - 1)))
  const indexes = []
  for (let i = 0; i < visible.length; i += step) indexes.push(i)
  // Always include the final month, but if it's within half a step of the last tick,
  // replace that tick instead of appending — otherwise the two labels overlap/crowd.
  const lastIdx = visible.length - 1
  if (indexes[indexes.length - 1] !== lastIdx) {
    if (lastIdx - indexes[indexes.length - 1] <= step / 2) indexes[indexes.length - 1] = lastIdx
    else indexes.push(lastIdx)
  }
  return indexes.map(index => {
    const row = visible[index]
    const xPct = (dateMs(row.month) - domain.start) / (domain.end - domain.start || 1) * 100
    return { key: row.month, label: monthShort(row.month), xPct: Math.max(0, Math.min(100, xPct)) }
  })
}
