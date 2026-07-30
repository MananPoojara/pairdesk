// Combine two 30 Cr-base backtest monthly series (Futures + Options) into one "both instruments"
// series for the Backtest page. Unlike Dashboard's live "both" mode (which weights by each
// instrument's LIVE client-AUM split), this is a pure backtest: whatever each series has for a
// given month gets summed as-is — no weighting, no client involved. A month where only one
// instrument has data (e.g. Options-only before Futures backtest data begins) is scaled against
// its own 30 Cr base; a month where both contribute is scaled against the combined 60 Cr base.
export function combineBacktestMonthly(seriesA, seriesB, baseCr = 30) {
  const baseInr = baseCr * 1e7
  const byMonth = new Map()
  const add = rows => {
    for (const r of rows || []) {
      const cur = byMonth.get(r.month) || {
        month: r.month, sources: 0, trades: 0,
        gross_inr: 0, charges_inr: 0, net_inr: 0, midcap_net_inr: 0, nifty_net_inr: 0,
      }
      cur.sources += 1
      cur.trades += Number(r.trades) || 0
      cur.gross_inr += Number(r.gross_inr) || 0
      cur.charges_inr += Number(r.charges_inr) || 0
      cur.net_inr += Number(r.net_inr) || 0
      cur.midcap_net_inr += Number(r.midcap_net_inr) || 0
      cur.nifty_net_inr += Number(r.nifty_net_inr) || 0
      byMonth.set(r.month, cur)
    }
  }
  add(seriesA)
  add(seriesB)
  const months = [...byMonth.keys()].sort()
  let cum = 0
  return months.map(month => {
    const r = byMonth.get(month)
    const base = r.sources >= 2 ? baseInr * 2 : baseInr
    cum += r.net_inr
    return {
      month, trades: r.trades,
      gross_inr: Math.round(r.gross_inr), charges_inr: Math.round(r.charges_inr),
      net_inr: Math.round(r.net_inr), cumulative_inr: Math.round(cum),
      midcap_net_inr: Math.round(r.midcap_net_inr), nifty_net_inr: Math.round(r.nifty_net_inr),
      pct: +(r.net_inr / base * 100).toFixed(3),
      midcap_pct: +(r.midcap_net_inr / base * 100).toFixed(3),
      nifty_pct: +(r.nifty_net_inr / base * 100).toFixed(3),
    }
  })
}
