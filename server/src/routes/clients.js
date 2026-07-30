import { query } from '../db/pg.js'
import { pairReferenceStats } from '../data/spotBacktest.js'
import { getLiveMarket } from '../data/liveMarket.js'
import { openCycleMonth } from '../data/openCycle.js'
import { buildClientBook } from '../data/lotCalc.js'
import { capitalSchedule } from '../data/capitalSchedule.js'
import { periodReturnPct, periodSharpe, periodMaxDdPct } from '../data/returns.js'
import { readLotSizeHistory } from '../data/lotSizeHistory.js'

const CR = 1e7   // rupees per crore

function sharpe(monthlyNets, aumInr) {
  if (monthlyNets.length < 2 || aumInr <= 0) return 0
  const pcts = monthlyNets.map(n => n / aumInr * 100)
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length
  const std  = Math.sqrt(pcts.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / (pcts.length - 1))
  return std === 0 ? 0 : +((mean / std * Math.sqrt(12)).toFixed(2))
}

function maxDrawdown(cumArr) {
  let peak = 0, maxDD = 0
  for (const v of cumArr) {
    if (v > peak) peak = v
    const dd = peak === 0 ? 0 : (peak - v) / peak
    if (dd > maxDD) maxDD = dd
  }
  return +(maxDD * 100).toFixed(2)
}

export async function clientsHandler(req, reply) {
  const lotHistory = await readLotSizeHistory()
  // 1. All active clients. Strategy allocations are fetched separately so
  // clients with multiple strategies still return as one client row.
  const { rows: clientRows } = await query(`
    SELECT c.id, c.code, c.name, c.category, c.aum_paise,
           ROUND(c.aum_paise / 1e9::numeric, 2) AS aum_cr,
           ROUND(c.aum_paise * 100.0 / NULLIF((SELECT SUM(aum_paise) FROM clients WHERE is_active), 0), 1) AS aum_pct,
           c.brokerage_pct, c.tax_pct, c.exec_type
    FROM clients c
    WHERE c.is_active = TRUE
    ORDER BY c.aum_paise DESC
  `)

  // Open cycle (most-recent-expiry pair) live values at the 30 Cr base — computed once. Each derived
  // client's July row is this × their scale (see applyOpenCycleToMonthly below). Its Excel exit is a
  // projected close; while held we mark to live LTP with entry-side charges only.
  const live = await getLiveMarket().catch(() => null)
  const liveLtp = { NIFTY: live?.nifty?.ltp, MIDCPNIFTY: live?.midcap?.ltp }
  const { rows: openExp } = await query(`SELECT MAX(expiry)::text AS expiry FROM trades`)
  const openMonthISO = openExp[0].expiry.slice(0, 8) + '01'
  const { rows: openLegs } = await query(`
    SELECT underlying, direction, lots, lot_size,
           entry_price::float AS entry_price, exit_price::float AS exit_price
    FROM trades WHERE expiry = $1
  `, [openExp[0].expiry])
  const openBase = openCycleMonth(openLegs, u => liveLtp[u])

  // 30 Cr master book (all legs) with per-leg round-trip charges — the base for every client's
  // quantity-based recompute. Fetched once; buildClientBook scales/rounds it per client.
  const { rows: baseRows } = await query(`
    SELECT t.id, t.trade_date::text AS trade_date, t.underlying, t.contract, t.expiry::text AS expiry,
           t.direction, (t.lots * t.lot_size)::int AS base_qty,
           t.entry_price::float AS entry, t.exit_price::float AS exit, t.regime,
           tc.stt_paise / 100.0 AS stt, tc.exchange_paise / 100.0 AS exch, tc.sebi_paise / 100.0 AS sebi,
           tc.stamp_paise / 100.0 AS stamp, tc.gst_paise / 100.0 AS gst, tc.total_paise / 100.0 AS charges
    FROM trades t JOIN trade_charges tc ON tc.trade_id = t.id
  `)
  const baseLegs = baseRows.map(r => ({
    id: r.id, trade_date: r.trade_date, underlying: r.underlying, contract: r.contract, expiry: r.expiry,
    direction: r.direction, base_qty: +r.base_qty, entry: +r.entry, exit: +r.exit, regime: r.regime,
    stt: +r.stt, exch: +r.exch, sebi: +r.sebi, stamp: +r.stamp, gst: +r.gst, charges: +r.charges,
  }))

  // Capital timeline per client (pay-in / pay-out ledger). Grouped once; each client's book is sized
  // by the exposure in force at each re-entry, so a mid-life top-up/withdrawal changes lots from that
  // trade-cycle forward. Clients with no events fall back to their single current exposure (legacy).
  const { rows: capEventRows } = await query(`
    SELECT client_id, to_char(effective_date, 'YYYY-MM-DD') AS effective_date, type,
           amount_paise / 1e9::numeric AS amount_cr
    FROM capital_events
  `)
  const eventsByClient = new Map()
  for (const e of capEventRows) {
    if (!eventsByClient.has(e.client_id)) eventsByClient.set(e.client_id, [])
    eventsByClient.get(e.client_id).push({ effective_date: e.effective_date, type: e.type, amount_cr: Number(e.amount_cr) })
  }

  const enriched = await Promise.all(clientRows.map(async (cl) => {
    const { rows: strategies } = await query(`
      SELECT cs.strategy_id, s.code, s.name,
             cs.joined_at::text,
             ROUND(cs.allocation_paise / 1e9::numeric, 2) AS allocation_cr,
             ROUND(COALESCE(NULLIF(cs.exposure_paise, 0), cs.allocation_paise) / 1e9::numeric, 2) AS exposure_cr,
             COALESCE(cs.leverage, 1)::float AS leverage,
             ROUND(COALESCE(NULLIF(cs.cash_paise, 0), cs.allocation_paise) / 1e9::numeric, 2) AS cash_cr,
             ROUND(cs.pledge_paise / 1e9::numeric, 2) AS pledge_cr
      FROM client_strategies cs
      JOIN strategies s ON s.id = cs.strategy_id
      WHERE cs.client_id = $1 AND cs.is_active = TRUE
      ORDER BY cs.id
    `, [cl.id])

    const primaryStrategy = strategies[0] || null
    const strategyId = primaryStrategy?.strategy_id || null
    const capitalBaseInr = Math.max(0, Number(primaryStrategy?.allocation_cr ?? cl.aum_cr) * CR)
    const returnPct = (net) => capitalBaseInr > 0 ? +(net / capitalBaseInr * 100).toFixed(2) : 0

    // Exposure = Capital × Leverage = the deployed capital the 30 Cr Excel was generated at (30 Cr base).
    // With a capital timeline, exposure (and thus the book's scale) steps at each pay-in / pay-out.
    const leverage = Number(primaryStrategy?.leverage ?? 1)
    const events = eventsByClient.get(cl.id) || []
    const sched = events.length ? capitalSchedule(events, leverage) : null
    const exposureCr = Number(primaryStrategy?.exposure_cr ?? primaryStrategy?.allocation_cr ?? cl.aum_cr)
    const scaleAt = sched ? sched.scaleAt : () => exposureCr / 30
    const joinDate = primaryStrategy?.joined_at || null  // 'YYYY-MM-DD' — only trades on/after this show

    // Quantity-based per-client book: scale the 30 Cr master to this client's exposure, round to whole
    // real NSE lots at each re-entry, roll between, and drive monthly / trades / charges off the qty.
    const book = buildClientBook(baseLegs, { scaleAt, joinDate, maxExpiry: openExp[0].expiry, openBase, liveLtp, lotHistory })
    const monthly = book.monthly
    const ch = book.charges

    // Per-month capital base = the running balance in force that month (a pay-in/pay-out steps it).
    // Drives Time-Weighted Return: % re-bases each period, cash-flow-neutral. Constant for no-event clients.
    const capAtMonth = (monthISO) => (sched ? sched.capitalAt(monthISO) : capitalBaseInr / CR) * CR
    const twrRows = monthly.map(m => ({ net_inr: +m.net_inr, capital_inr: capAtMonth(m.month) }))

    const netByMonth = monthly.map(m => +m.net_inr)
    const cumArr     = monthly.map(m => +m.cumulative_inr)
    const totalNet   = cumArr[cumArr.length - 1] || 0
    const wins       = monthly.filter(m => +m.net_inr > 0).length
    const netArr     = netByMonth.filter(n => isFinite(n))

    return {
      code:          cl.code,
      name:          cl.name,
      category:      cl.category,
      aum_cr:        +cl.aum_cr,
      aum_pct:       +cl.aum_pct,
      brokerage_pct: +cl.brokerage_pct,
      tax_pct:       +cl.tax_pct,
      exec_type:     cl.exec_type || 'F2F',
      joined_at: primaryStrategy?.joined_at || null,
      capital_events: events,   // [{ effective_date, type, amount_cr }] — for the frontend variant timeline
      strategies: strategies.map(s => ({
        code: s.code,
        name: s.name,
        joined_at: s.joined_at,
        allocation_cr: +s.allocation_cr,
        exposure_cr: +s.exposure_cr,
        leverage: +s.leverage,
        cash_cr: +s.cash_cr,
        pledge_cr: +s.pledge_cr,
      })),
      stats: {
        net_inr:         Math.round(totalNet),
        net_cr:          +(totalNet / CR).toFixed(2),
        return_pct:      periodReturnPct(twrRows),         // net ÷ capital, summed over the capital timeline
        gross_inr:       Math.round(monthly.reduce((s, m) => s + +m.gross_inr, 0)),
        charges_inr:     Math.round(+ch.total || 0),
        sharpe:          periodSharpe(twrRows),
        win_rate:        monthly.length ? +(wins / monthly.length * 100).toFixed(1) : 0,
        wins,
        total_months:    monthly.length,
        max_dd_pct:      periodMaxDdPct(twrRows),           // drawdown on cumulative-return equity (cash-flow-neutral)
        pair_max_dd_pct: periodMaxDdPct(twrRows),
        best_month_inr:  Math.round(netArr.length ? Math.max(...netArr) : 0),
        worst_month_inr: Math.round(netArr.length ? Math.min(...netArr) : 0),
      },
      monthly: monthly.map(m => {
        const cap = capAtMonth(m.month)
        const pctOf = (net) => cap > 0 ? +(net / cap * 100).toFixed(2) : 0
        return {
          month:          m.month,
          gross_inr:      Math.round(+m.gross_inr),
          charges_inr:    Math.round(+m.charges_inr),
          net_inr:        Math.round(+m.net_inr),
          cumulative_inr: Math.round(+m.cumulative_inr),
          capital_inr:    Math.round(cap),                     // capital in force this month (timeline)
          pct:            pctOf(+m.net_inr),
          midcap_net_inr: Math.round(+m.midcap_net_inr || 0),
          nifty_net_inr:  Math.round(+m.nifty_net_inr || 0),
          midcap_pct:     pctOf(+m.midcap_net_inr || 0),
          nifty_pct:      pctOf(+m.nifty_net_inr || 0),
        }
      }),
      recent_trades: book.recent.map(g => ({
        date:        g.trade_date,
        expiry:      g.expiry,
        underlying:  g.underlying,
        contract:    g.contract,
        direction:   g.direction,
        lots:        g.cQty / g.lot,     // whole real lots (Size = lots × lot_size = client qty)
        lot_size:    g.lot,
        entry:       g.entry,
        exit:        g.exit,             // open cycle already marked to live LTP in buildClientBook
        regime:      g.regime,
        gross_inr:   Math.round(g.gross),
        charges_inr: Math.round(g.charges),
        net_inr:     Math.round(g.net),
        combined_pl_inr: Math.round(g.combined_pl_inr),
        combined_pct: returnPct(g.combined_pl_inr),
      })),
      positions: book.positions.map(p => ({
        underlying:  p.underlying,
        contract:    p.contract,
        expiry:      p.expiry,
        direction:   p.direction,
        lots:        p.cQty / p.lot,
        lot_size:    p.lot,
        entry_price: p.entry,
      })),
      charges: {
        total_inr: Math.round(+ch.total),
        stt_inr:   Math.round(+ch.stt),
        exch_inr:  Math.round(+ch.exch),
        sebi_inr:  Math.round(+ch.sebi),
        stamp_inr: Math.round(+ch.stamp),
        gst_inr:   Math.round(+ch.gst),
      },
    }
  }))

  // Summary
  const totalAumCr = enriched.reduce((s, c) => s + c.aum_cr, 0)
  const catMap = {}
  enriched.forEach(c => {
    if (!catMap[c.category]) catMap[c.category] = { count: 0, aum_cr: 0, net_cr: 0 }
    catMap[c.category].count++
    catMap[c.category].aum_cr  += c.aum_cr
    catMap[c.category].net_cr  += c.stats.net_cr
  })

  return {
    summary: {
      total_aum_cr: +totalAumCr.toFixed(2),
      total_net_cr: +enriched.reduce((s, c) => s + c.stats.net_cr, 0).toFixed(2),
      categories:   catMap,
    },
    clients: enriched,
  }
}
