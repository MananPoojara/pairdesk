// Per-period return on the capital in force each month (pay-in / pay-out timeline). This is the
// project's original model — total net ÷ capital — generalised to a changing capital base: each
// month's P&L is measured against that month's capital, then summed (arithmetic, NOT compounded —
// the strategy sizes on the stated allocation, profits aren't reinvested into position size). For a
// constant capital it reduces exactly to totalNet / capital, so flat-capital clients are unchanged.
// Mirrors web/src/lib/returns.js — keep the two in sync.
//
// rows: [{ net_inr, capital_inr }] chronological. baseFactor scales the capital base uniformly
// (e.g. cash/allocation for the Return-on-Cash toggle).

export function monthlyReturns(rows, baseFactor = 1) {
  return rows.map(m => {
    const cap = (Number(m.capital_inr) || 0) * baseFactor
    return cap > 0 ? Number(m.net_inr) / cap : 0
  })
}

// Sum of each month's return on the capital in force that month.
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

// Drawdown on the equity index E = 1 + running sum of per-period returns (peak starts at the pre-series
// 1.0). Cash-flow-neutral: a pay-in/pay-out month has net 0 → r 0 → no jump. For a constant capital
// this equals the old capitalMaxDrawdownPct (equity = capital + cumulative P&L).
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

// ── self-check ──────────────────────────────────────────────────────────────
export function demo() {
  const assert = (c, m) => { if (!c) throw new Error('returns demo: ' + m) }
  const near = (a, b, e = 0.01) => Math.abs(a - b) < e
  // Constant 100, +10 then +10 → 10% + 10% = 20% (arithmetic, not 21%).
  const flat = [{ net_inr: 10, capital_inr: 100 }, { net_inr: 10, capital_inr: 100 }]
  assert(near(periodReturnPct(flat), 20), 'flat 20%')
  // Constant capital ⇒ equals totalNet / capital.
  assert(near(periodReturnPct(flat), 20 / 100 * 100), 'reduces to totalNet/capital')
  // Capital doubles after a pay-in: +10 on 100 then +10 on 200 → 10% + 5% = 15%.
  const step = [{ net_inr: 10, capital_inr: 100 }, { net_inr: 10, capital_inr: 200 }]
  assert(near(periodReturnPct(step), 15), 'stepped 15%')
  // A pure pay-in month (net 0) contributes 0 — cash-flow neutral.
  assert(near(periodReturnPct([...step, { net_inr: 0, capital_inr: 200 }]), 15), 'flow month neutral')
  // baseFactor 0.5 (cash basis) halves the base → doubles each period's %.
  assert(near(periodReturnPct(flat, 0.5), 40), 'baseFactor 0.5 → 40%')
  // Drawdown: +10% then −20% → E 1→1.1→0.9 → (1.1−0.9)/1.1 = 18.18%.
  assert(near(periodMaxDdPct([{ net_inr: 10, capital_inr: 100 }, { net_inr: -20, capital_inr: 100 }]), 18.18), 'maxDd 18.18%')
  return 'ok'
}

if (process.argv[1] && process.argv[1].endsWith('returns.js')) console.log(demo())
