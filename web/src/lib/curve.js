// Catmull-Rom equity curve → SVG path, ported from R4's buildCurvePath.
export function buildCurvePath(monthly, W, H, pad = 6) {
  if (!monthly || !monthly.length) {
    return { line: `M0,${H} L${W},${H}`, fill: `M0,${H} L${W},${H} Z` }
  }
  const vals = monthly.map(m => m.cumulative_inr)
  const minV = Math.min(0, Math.min(...vals))
  const maxV = Math.max(...vals)
  const range = maxV - minV || 1
  const n = vals.length
  const pts = vals.map((v, i) => ({
    x: n === 1 ? W / 2 : (i / (n - 1)) * (W - pad * 2) + pad,
    y: H - pad - ((v - minV) / range) * (H - pad * 2),
  }))
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
  return { line: d, fill: `${d} L${last.x},${H} L${first.x},${H} Z` }
}

// Monthly heatmap colour + text, ported from R4's hmColor/hmText.
export function hmColor(pct) {
  if (pct === null || pct === undefined) return '#F0E7D9'
  return pct >= 0 ? '#7DD3FC' : '#FDBA74'   // flat lighter: positive = light blue, negative = light orange
}
export function hmText(pct) {
  if (pct === null || pct === undefined) return '#C9BBA6'
  return '#000000'
}
