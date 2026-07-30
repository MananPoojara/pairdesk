// Per-period return on the capital in force each month (pay-in / pay-out timeline). Mirror of
// server/src/data/returns.js — keep in sync. Each month's P&L is measured against that month's
// capital, then summed (arithmetic, not compounded); for a constant capital it reduces to
// totalNet / capital, so flat-capital clients are unchanged.
//
// rows: [{ net_inr, capital_inr }] chronological. baseFactor scales the capital base uniformly
// (e.g. cash/allocation for the Return-on-Cash toggle).

export function monthlyReturns(rows, baseFactor = 1) {
  return rows.map(m => {
    const cap = (Number(m.capital_inr) || 0) * baseFactor
    return cap > 0 ? Number(m.net_inr) / cap : 0
  })
}

export function periodReturnPct(rows, baseFactor = 1) {
  return +(monthlyReturns(rows, baseFactor).reduce((s, r) => s + r, 0) * 100).toFixed(2)
}

export function periodSharpe(rows, baseFactor = 1) {
  const rs = monthlyReturns(rows, baseFactor).map(r => r * 100)
  if (rs.length < 2) return 0
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length
  const std = Math.sqrt(rs.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / (rs.length - 1))
  return std === 0 ? 0 : +((mean / std * Math.sqrt(12)).toFixed(2))
}

// Drawdown on the equity index E = 1 + running sum of per-period returns (peak starts at pre-series 1.0).
// Cash-flow-neutral; for a constant capital this equals the old capitalMaxDrawdownPct.
export function periodMaxDdPct(rows, baseFactor = 1) {
  let e = 1, peak = 1, dd = 0
  for (const r of monthlyReturns(rows, baseFactor)) {
    e += r
    if (e > peak) peak = e
    const d = peak > 0 ? (peak - e) / peak : 0
    if (d > dd) dd = d
  }
  return +(dd * 100).toFixed(2)
}
