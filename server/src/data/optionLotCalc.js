// Per-client real-lot quantity model for the OPTIONS book — the parity twin of lotCalc.js (futures).
// Unlike futures, options don't roll a position across expiries: each weekly pair-trade opens and closes
// on its own, so every trade is sized independently at ITS entry date using the client's exposure
// (capital × leverage) in force then — capital-timeline (pay-in / pay-out) aware, floor-to-1-lot.
//
// Each trade is a PAIR: a short NIFTY option leg (real, charged, margined) + a hypothetical MIDCAP100
// future hedge leg (no charges — it's not a real broker position). Both legs are sized independently on
// their own notional and real NSE lot schedule (see lotCalc.lotSize). Charges scale exactly by lot count
// (charges ∝ turnover ∝ qty). Margin = both legs' notional × MARGIN_PCT (SPAN+exposure approximation,
// same 12% the futures margin card uses).

import { lotSize } from './lotCalc.js'

const CR = 1e7
export const MARGIN_PCT = 0.12

// Display window: options are shown from this date onward (2019–2021 excluded per user). The DB/file
// keep the full history; this only windows what the API serves.
export const OPTIONS_WINDOW_START = '2022-01-01'

// Source strategy (phase) by trade_no — the 5 files appended in fixed order (Trade ID preserved through
// the date-sort). Derived at read time so the DB needn't store a strategy column. Verified vs option_trades.
export function optionPhase(tradeNo) {
  if (tradeNo <= 78) return '1st Month'
  if (tradeNo <= 344) return 'XTROC'
  if (tradeNo <= 371) return 'M5DP'
  if (tradeNo <= 513) return 'TROC'
  return 'Bear Short'
}

// trades: per-trade rows (option leg joined to its midcap leg):
//   { trade_no, strategy, entry_date, exit_date, expiry, opt_type, strike, side,
//     entry_spot, opt_entry, opt_exit, opt_pts,
//     stt1, exch1, sebi1, stamp1, gst1, total_ch1,   // 1-lot option-leg charges (₹)
//     mid_spot, mid_side, mid_pts }                  // midcap hedge (spot = fut-leg entry_px)
// opts: { exposureAt(dateISO)->Cr, capitalAt(dateISO)->Cr, joinDate|null, maxExpiry }
export function buildClientOptionBook(trades, { exposureAt, capitalAt, joinDate, maxExpiry, lotHistory }) {
  const rows = trades
    .filter(t => !joinDate || t.entry_date >= joinDate)
    .map(t => {
      const expoInr = exposureAt(t.entry_date) * CR

      // Option leg — real short position: discrete NIFTY lots, charges ×lots, on the underlying notional.
      const oLot = lotSize('NIFTY', t.expiry, lotHistory)
      const oLots = Math.max(1, Math.round(expoInr / (t.entry_spot * oLot)))
      const oQty = oLots * oLot
      const grossOpt = t.opt_pts * oQty
      const f = oLots                                   // 1-lot backtest → client = ×lots (exact)
      const stt = t.stt1 * f, exch = t.exch1 * f, sebi = t.sebi1 * f, stamp = t.stamp1 * f, gst = t.gst1 * f
      const charges = t.total_ch1 * f
      const netOpt = grossOpt - charges
      const optNotional = t.entry_spot * oQty

      // Midcap hedge leg — hypothetical: discrete MIDCPNIFTY lots, NO charges.
      const mLot = lotSize('MIDCPNIFTY', t.expiry, lotHistory)
      const mLots = Math.max(1, Math.round(expoInr / (t.mid_spot * mLot)))
      const mQty = mLots * mLot
      const grossMid = t.mid_pts * mQty
      const midNotional = t.mid_spot * mQty

      const gross = grossOpt + grossMid
      const net = netOpt + grossMid                     // hedge has no charges
      const margin = (optNotional + midNotional) * MARGIN_PCT
      const month = t.expiry.slice(0, 7) + '-01'
      return {
        trade_no: t.trade_no, strategy: t.strategy, month,
        entry: t.entry_date, exit: t.exit_date, expiry: t.expiry,
        opt_type: t.opt_type, strike: t.strike, side: t.side,
        opt_lots: oLots, opt_lot: oLot, opt_qty: oQty, opt_entry: t.opt_entry, opt_exit: t.opt_exit,
        mid_side: t.mid_side, mid_lots: mLots, mid_lot: mLot, mid_qty: mQty,
        gross_opt: grossOpt, net_opt: netOpt, gross_mid: grossMid,
        gross, net, charges, stt, exch, sebi, stamp, gst,
        opt_notional: optNotional, mid_notional: midNotional, margin,
        isOpen: t.expiry === maxExpiry,
      }
    })

  // Monthly (by expiry month) + running cumulative + per-month capital base (for the return-% denominator).
  const months = [...new Set(rows.map(r => r.month))].sort()
  let cum = 0
  const monthly = months.map(month => {
    const mr = rows.filter(r => r.month === month)
    const gross = mr.reduce((s, r) => s + r.gross, 0)
    const charges = mr.reduce((s, r) => s + r.charges, 0)
    const net = gross - charges
    cum += net
    // Capital base for the return-% denominator = capital in force when the month's trades were entered
    // (evaluated at the latest entry date, so a mid-month join lands after its own pay-in event).
    const lastEntry = mr.reduce((mx, r) => (r.entry > mx ? r.entry : mx), '')
    return {
      month, trades: mr.length,
      gross_inr: gross, charges_inr: charges, net_inr: net, cumulative_inr: cum,
      capital_inr: capitalAt ? Math.round(capitalAt(lastEntry) * CR) : null,
    }
  })

  const sum = k => rows.reduce((s, r) => s + r[k], 0)
  const charges = { total: sum('charges'), stt: sum('stt'), exch: sum('exch'), sebi: sum('sebi'), stamp: sum('stamp'), gst: sum('gst') }

  const positions = rows.filter(r => r.expiry === maxExpiry)
  const margin = positions.reduce((s, r) => s + r.margin, 0)
  const recent = [...rows].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : b.trade_no - a.trade_no))

  return { monthly, recent, positions, charges, margin, rows }
}
