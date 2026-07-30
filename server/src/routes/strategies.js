import { query } from '../db/pg.js'
import { pairReferenceStats } from '../data/spotBacktest.js'
import { getLiveMarket } from '../data/liveMarket.js'
import { openCycleMonth, applyOpenCycleToMonthly } from '../data/openCycle.js'

// 1 Cr = 1e7 INR = 1e9 paise
function sharpe(nets, aumInr) {
  if (nets.length < 2) return 0
  const pcts = nets.map(n => n / aumInr * 100)
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length
  const std = Math.sqrt(pcts.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / (pcts.length - 1))
  return std === 0 ? 0 : +((mean / std * Math.sqrt(12)).toFixed(2))
}
function maxDrawdown(cum) {
  let peak = 0, maxDD = 0
  for (const v of cum) { if (v > peak) peak = v; const dd = peak === 0 ? 0 : (peak - v) / peak; if (dd > maxDD) maxDD = dd }
  return +(maxDD * 100).toFixed(2)
}

export async function strategiesHandler(req, reply) {
  // Total AUM (active clients)
  const { rows: aumRow } = await query(`
    SELECT COALESCE(SUM(aum_paise),0)::float AS p FROM clients WHERE is_active = TRUE
  `)
  const AUM_INR = aumRow[0].p / 100    // total platform AUM — display only
  const AUM_CR = aumRow[0].p / 1e9    // total platform AUM — display only
  // Trades are calibrated at 30 Cr deployment — use for all % calculations
  const BASE_CR = 30
  const BASE_INR = BASE_CR * 1e7

  // Monthly P&L across the whole platform (with trade counts)
  const { rows: monthly } = await query(`
    WITH m AS (
      -- Book each cycle's P&L in its EXPIRY month (when realised), matching the dashboard +
      -- clients pages — so the May-entry / June-expiry cycle shows up as June, not May.
      SELECT to_char(date_trunc('month', t.expiry), 'YYYY-MM-01') AS month,
             COUNT(*) AS trades,
             SUM(CASE WHEN t.direction='LONG'
                      THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
                      ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size END) AS gross_inr,
             SUM(CASE WHEN t.underlying='MIDCPNIFTY' THEN
                 CASE WHEN t.direction='LONG'
                      THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
                      ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size END
                 ELSE 0 END) AS midcap_gross_inr,
             SUM(CASE WHEN t.underlying='NIFTY' THEN
                 CASE WHEN t.direction='LONG'
                      THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
                      ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size END
                 ELSE 0 END) AS nifty_gross_inr,
             SUM(tc.total_paise)/100.0 AS charges_inr
             ,SUM(CASE WHEN t.underlying='MIDCPNIFTY' THEN tc.total_paise ELSE 0 END)/100.0 AS midcap_charges_inr
             ,SUM(CASE WHEN t.underlying='NIFTY' THEN tc.total_paise ELSE 0 END)/100.0 AS nifty_charges_inr
      FROM trades t
      JOIN trade_charges tc ON tc.trade_id = t.id
      GROUP BY month
      ORDER BY month
    )
    SELECT *, gross_inr - charges_inr AS net_inr,
           midcap_gross_inr - midcap_charges_inr AS midcap_net_inr,
           nifty_gross_inr - nifty_charges_inr AS nifty_net_inr,
           SUM(gross_inr - charges_inr) OVER (ORDER BY month) AS cumulative_inr
    FROM m
  `)

  // Live-mark the open cycle (most-recent-expiry pair). Its Excel exit is a projected close; while
  // held, override that month with the live MTM (entry-side charges only) so every stat below follows.
  // `?frozen=1` (used by the Backtest page, which wants the pure historical/backtest number, never
  // live LTP) skips this override — every other caller (Dashboard, Strategies) is unaffected.
  const frozen = req.query?.frozen === '1' || req.query?.frozen === 'true'
  if (!frozen) {
    const live = await getLiveMarket().catch(() => null)
    const liveLtp = { NIFTY: live?.nifty?.ltp, MIDCPNIFTY: live?.midcap?.ltp }
    const { rows: latestExpiry } = await query(`SELECT MAX(expiry)::text AS expiry FROM trades`)
    const maxExpiry = latestExpiry[0].expiry
    const { rows: positions } = await query(`
      SELECT t.underlying, t.direction, t.lots, t.lot_size,
             t.entry_price::float AS entry_price, t.exit_price::float AS exit_price
      FROM trades t WHERE t.expiry = $1
    `, [maxExpiry])
    applyOpenCycleToMonthly(monthly, maxExpiry.slice(0, 8) + '01', openCycleMonth(positions, u => liveLtp[u]))
  }

  const nets = monthly.map(m => +m.net_inr)
  const cum = monthly.map(m => +m.cumulative_inr)
  const totalNet = cum[cum.length - 1] || 0
  const grossTotal = monthly.reduce((s, m) => s + +m.gross_inr, 0)
  const tradesTotal = monthly.reduce((s, m) => s + +m.trades, 0)
  const wins = monthly.filter(m => +m.net_inr > 0).length
  const months = monthly.length
  const returnPct = +(totalNet / BASE_INR * 100).toFixed(2)
  const cagr = months > 0 ? +((Math.pow(1 + totalNet / BASE_INR, 12 / months) - 1) * 100).toFixed(2) : 0

  // Year-on-year
  const byYear = {}
  monthly.forEach(m => {
    const y = m.month.slice(0, 4)
    if (!byYear[y]) byYear[y] = { nets: [], trades: 0, net: 0 }
    byYear[y].nets.push(+m.net_inr); byYear[y].trades += +m.trades; byYear[y].net += +m.net_inr
  })
  const yearly = Object.keys(byYear).sort().map(y => {
    const yy = byYear[y]
    let c = 0; const cumY = yy.nets.map(n => (c += n))
    return {
      year: y, trades: yy.trades,
      net_inr: Math.round(yy.net), net_cr: +(yy.net / 1e7).toFixed(2),
      return_pct: +(yy.net / BASE_INR * 100).toFixed(2),
      max_dd_pct: (() => {
        // capital-based drawdown: start from BASE_CR, not from zero
        let cum = 0, peak = BASE_INR, maxDD = 0
        for (const n of yy.nets) {
          cum += n
          const eq = BASE_INR + cum
          if (eq > peak) peak = eq
          const dd = (peak - eq) / peak
          if (dd > maxDD) maxDD = dd
        }
        return +(maxDD * 100).toFixed(2)
      })(),
      sharpe: sharpe(yy.nets, BASE_INR),
    }
  })

  return {
    summary: {
      name: 'Pair Trading',
      subtitle: 'Midcap × Nifty · futures pair',
      active: true,
      net_inr: Math.round(totalNet), net_cr: +(totalNet / 1e7).toFixed(2),
      gross_inr: Math.round(grossTotal), gross_cr: +(grossTotal / 1e7).toFixed(2),
      return_pct: returnPct,
      trades: tradesTotal,
      win_rate: months ? +(wins / months * 100).toFixed(1) : 0,
      wins, months,
      sharpe: sharpe(nets, BASE_INR),
      max_dd_pct: pairReferenceStats.max_dd_pct || maxDrawdown(cum),
      pair_max_dd_pct: pairReferenceStats.max_dd_pct || maxDrawdown(cum),
      cagr_pct: cagr,
      aum_cr: +AUM_CR.toFixed(2),
      base_aum_cr: BASE_CR,
      exposure_cr: +AUM_CR.toFixed(2),
      since: '26 Sep 2024',
    },
    monthly: monthly.map(m => ({
      month: m.month, trades: +m.trades,
      gross_inr: Math.round(+m.gross_inr), charges_inr: Math.round(+m.charges_inr),
      net_inr: Math.round(+m.net_inr), cumulative_inr: Math.round(+m.cumulative_inr),
      midcap_net_inr: Math.round(+m.midcap_net_inr), nifty_net_inr: Math.round(+m.nifty_net_inr),
      midcap_pct: AUM_INR ? +(+m.midcap_net_inr / AUM_INR * 100).toFixed(3) : 0,
      nifty_pct: AUM_INR ? +(+m.nifty_net_inr / AUM_INR * 100).toFixed(3) : 0,
      pct: +(+m.net_inr / BASE_INR * 100).toFixed(3),
      midcap_pct: +(+m.midcap_net_inr / BASE_INR * 100).toFixed(3),
      nifty_pct: +(+m.nifty_net_inr / BASE_INR * 100).toFixed(3),
    })),
    yearly,
  }
}
