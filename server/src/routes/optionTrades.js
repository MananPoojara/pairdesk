import { query } from '../db/pg.js'
import { optionPhase, OPTIONS_WINDOW_START } from '../data/optionLotCalc.js'

// The F2O (fut×option) book, derived from the LEGWISE `option_trade_legs` (Data/ingest_option_legs.py).
// Full history (598 trades, 2019→2026). Returns the shape the frontend consumes for VARIANTS.options
// — { trades, monthly, summary, yearly } — so the Options cards + blotter reconcile to the SAME trades.
//
// Charges: real NSE option charge model (STT/exchange/SEBI/stamp/GST) lives on each option leg in ₹.
// To fold it into the %-based, capital-scaled return model we use a SCALE-INVARIANT drag:
//   charge_pct = total_charges_inr / (entry_spot × lot_size) × 100   (charge as % of option notional)
//   net_pct    = combined_pnl_pct − charge_pct
// At any capital both notional and charges scale together, so charge_pct is invariant → exact.
// Base is ₹30 Cr (like the futures blueprint); the frontend scales ₹ to each client's capital.

const BASE_CR = 30
const BASE_INR = BASE_CR * 1e7

function sharpe(pcts) {
  if (pcts.length < 2) return 0
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length
  const std = Math.sqrt(pcts.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / (pcts.length - 1))
  return std === 0 ? 0 : +((mean / std) * Math.sqrt(12)).toFixed(2)
}
// Capital-based max drawdown: equity starts at the deployed capital (₹30 Cr), not zero.
function capitalMaxDd(netsInr) {
  let cum = 0, peak = BASE_INR, maxDd = 0
  for (const n of netsInr) {
    cum += n
    const eq = BASE_INR + cum
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak
    if (dd > maxDd) maxDd = dd
  }
  return +(maxDd * 100).toFixed(2)
}

export async function optionTradesHandler(req, reply) {
  // 1. Trade blotter (option leg = leg 1). pct is NET of charges (per-trade); gross_pct/charge_pct exposed too.
  const { rows: rawTrades } = await query(`
    SELECT trade_no, entry_date::text AS entry, exit_date::text AS exit, expiry::text AS expiry,
           opt_type, strike::float AS strike, side AS buy_sell, qty,
           entry_px::float AS opt_entry, exit_px::float AS opt_exit,
           (combined_pnl_pct - COALESCE(charge_pct,0))::float AS pct,
           combined_pnl_pct::float AS gross_pct, COALESCE(charge_pct,0)::float AS charge_pct
    FROM option_trade_legs WHERE leg = 1 AND entry_date >= $1 ORDER BY entry_date, expiry
  `, [OPTIONS_WINDOW_START])
  const trades = rawTrades.map(t => ({ strategy: optionPhase(t.trade_no), ...t }))   // strategy derived, not stored

  // 2. Monthly (by EXPIRY month, realised — same convention as the futures book), ADDITIVE, NET of charges.
  const { rows: mrows } = await query(`
    SELECT to_char(date_trunc('month', expiry), 'YYYY-MM-01') AS month,
           COUNT(*)::int AS trades,
           SUM(combined_pnl_pct)::float AS gross_pct,
           SUM(COALESCE(charge_pct,0))::float AS charge_pct
    FROM option_trade_legs WHERE leg = 1 AND entry_date >= $1 GROUP BY 1 ORDER BY 1
  `, [OPTIONS_WINDOW_START])
  let cum = 0
  const monthly = mrows.map(r => {
    const net_pct = r.gross_pct - r.charge_pct
    const gross_inr = Math.round(r.gross_pct / 100 * BASE_INR)
    const net_inr = Math.round(net_pct / 100 * BASE_INR)
    cum += net_inr
    return {
      month: r.month, trades: r.trades,
      gross_inr, charges_inr: gross_inr - net_inr, net_inr, cumulative_inr: cum,
      midcap_net_inr: 0, nifty_net_inr: 0,
      pct: +net_pct.toFixed(3), midcap_pct: 0, nifty_pct: 0,
    }
  })

  // 3. Summary (all derived from the monthly NET series)
  const pcts = monthly.map(m => m.pct)
  const nets = monthly.map(m => m.net_inr)
  const returnPct = +pcts.reduce((a, b) => a + b, 0).toFixed(2)
  const netInr = Math.round(returnPct / 100 * BASE_INR)
  const grossInr = monthly.reduce((a, m) => a + m.gross_inr, 0)
  const wins = monthly.filter(m => m.net_inr > 0).length
  const months = monthly.length
  const maxDd = capitalMaxDd(nets)
  const firstM = monthly[0]?.month, lastM = monthly[monthly.length - 1]?.month
  const fmtMonYr = (iso) => { const dt = new Date(iso + 'T00:00:00Z'); return dt.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) }
  const summary = {
    name: 'Pair Trading — Options', subtitle: `${fmtMonYr(firstM)} – ${fmtMonYr(lastM)}`, active: false,
    net_inr: netInr, net_cr: +(netInr / 1e7).toFixed(2),
    gross_inr: grossInr, gross_cr: +(grossInr / 1e7).toFixed(2),
    return_pct: returnPct, trades: trades.length,
    win_rate: months ? +(wins / months * 100).toFixed(2) : 0, wins, months,
    sharpe: sharpe(pcts), max_dd_pct: maxDd, pair_max_dd_pct: maxDd,
    best_month_pct: pcts.length ? +Math.max(...pcts).toFixed(2) : 0,
    worst_month_pct: pcts.length ? +Math.min(...pcts).toFixed(2) : 0,
    cagr_pct: months ? +((Math.pow(1 + returnPct / 100, 12 / months) - 1) * 100).toFixed(2) : 0,
    aum_cr: BASE_CR, base_aum_cr: BASE_CR, exposure_cr: BASE_CR, since: fmtMonYr(firstM),
  }

  // 4. Yearly (by expiry year), NET
  const byYear = {}
  for (const m of monthly) {
    const y = m.month.slice(0, 4)
    ;(byYear[y] ||= { nets: [], net: 0, trades: 0 })
    byYear[y].nets.push(m.net_inr); byYear[y].net += m.net_inr; byYear[y].trades += m.trades
  }
  const yearly = Object.keys(byYear).sort().map(y => {
    const yy = byYear[y]
    return {
      year: y, trades: yy.trades,
      net_inr: Math.round(yy.net), net_cr: +(yy.net / 1e7).toFixed(2),
      return_pct: +(yy.net / BASE_INR * 100).toFixed(2),
      max_dd_pct: capitalMaxDd(yy.nets),
      sharpe: sharpe(yy.nets.map(n => n / BASE_INR * 100)),
    }
  })

  return { base_aum_cr: BASE_CR, trades, monthly, summary, yearly }
}
