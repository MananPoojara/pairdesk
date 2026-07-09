import { query } from '../db/pg.js'
import { pairReferenceStats } from '../data/spotBacktest.js'

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
  // 1. All active clients. Strategy allocations are fetched separately so
  // clients with multiple strategies still return as one client row.
  const { rows: clientRows } = await query(`
    SELECT c.id, c.code, c.name, c.category, c.aum_paise,
           ROUND(c.aum_paise / 1e9::numeric, 2) AS aum_cr,
           ROUND(c.aum_paise * 100.0 / NULLIF((SELECT SUM(aum_paise) FROM clients WHERE is_active), 0), 1) AS aum_pct,
           c.brokerage_pct, c.tax_pct
    FROM clients c
    WHERE c.is_active = TRUE
    ORDER BY c.aum_paise DESC
  `)

  const enriched = await Promise.all(clientRows.map(async (cl) => {
    const { rows: strategies } = await query(`
      SELECT cs.strategy_id, s.code, s.name,
             cs.joined_at::text,
             ROUND(cs.allocation_paise / 1e9::numeric, 2) AS allocation_cr,
             ROUND(COALESCE(NULLIF(cs.exposure_paise, 0), cs.allocation_paise) / 1e9::numeric, 2) AS exposure_cr,
             COALESCE(cs.leverage, 1)::float AS leverage
      FROM client_strategies cs
      JOIN strategies s ON s.id = cs.strategy_id
      WHERE cs.client_id = $1 AND cs.is_active = TRUE
      ORDER BY cs.id
    `, [cl.id])

    const primaryStrategy = strategies[0] || null
    const strategyId = primaryStrategy?.strategy_id || null
    const capitalBaseInr = Math.max(0, Number(primaryStrategy?.allocation_cr ?? cl.aum_cr) * CR)
    const returnPct = (net) => capitalBaseInr > 0 ? +(net / capitalBaseInr * 100).toFixed(2) : 0

    // Does this client have direct trades?
    const { rows: tradeCount } = await query(
      `SELECT COUNT(*)::int AS cnt FROM trades WHERE client_id = $1`, [cl.id]
    )
    const hasDirect = tradeCount[0].cnt > 0

    // For clients without direct trades: derive from platform trades scaled by allocation ratio.
    // BASE_ALLOC_CR = 30 is the deployment level the Excel trades were generated at.
    const BASE_ALLOC_CR = 30
    const scale = hasDirect ? 1 : (primaryStrategy ? primaryStrategy.allocation_cr / BASE_ALLOC_CR : 1)
    // joined_at date filter — only show trades on/after the client's join date
    const joinDate = primaryStrategy?.joined_at || null  // 'YYYY-MM-DD' string or null

    // Monthly P&L
    const { rows: monthly } = hasDirect
      ? await query(`
          WITH m AS (
            SELECT
              to_char(date_trunc('month', t.trade_date), 'YYYY-MM-01') AS month,
              SUM(
                CASE WHEN t.direction = 'LONG'
                     THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
                     ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size
                END
              )::float                      AS gross_inr,
              SUM(tc.total_paise) / 100.0   AS charges_inr
            FROM trades t
            JOIN trade_charges tc ON tc.trade_id = t.id
            WHERE t.client_id = $1
              AND ($2::int IS NULL OR t.strategy_id = $2)
            GROUP BY month
            ORDER BY month
          )
          SELECT *,
                 (gross_inr - charges_inr)                                   AS net_inr,
                 SUM(gross_inr - charges_inr) OVER (ORDER BY month)::float  AS cumulative_inr
          FROM m
        `, [cl.id, strategyId])
      : await query(`
          WITH m AS (
            SELECT
              to_char(date_trunc('month', t.trade_date), 'YYYY-MM-01') AS month,
              SUM(
                CASE WHEN t.direction = 'LONG'
                     THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
                     ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size
                END
              )::float * $1                  AS gross_inr,
              SUM(tc.total_paise) / 100.0 * $1 AS charges_inr
            FROM trades t
            JOIN trade_charges tc ON tc.trade_id = t.id
            WHERE ($2::date IS NULL OR t.trade_date >= $2::date)
            GROUP BY month
            ORDER BY month
          )
          SELECT *,
                 (gross_inr - charges_inr)                                   AS net_inr,
                 SUM(gross_inr - charges_inr) OVER (ORDER BY month)::float  AS cumulative_inr
          FROM m
        `, [scale, joinDate])

    // All trades (newest first) — used for client-side range filtering
    const { rows: recent } = hasDirect
      ? await query(`
          WITH r AS (
            SELECT t.trade_date::text, t.client_id, t.strategy_id, t.underlying, t.contract, t.direction,
                   t.expiry::text,
                   t.lots, t.lot_size,
                   t.entry_price::float AS entry_price,
                   t.exit_price::float  AS exit_price,
                   t.regime,
                   CASE WHEN t.direction = 'LONG'
                        THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
                        ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size
                   END::float               AS gross_inr,
                   tc.total_paise / 100.0   AS charges_inr
            FROM trades t
            JOIN trade_charges tc ON tc.trade_id = t.id
            WHERE t.client_id = $1
              AND ($2::int IS NULL OR t.strategy_id = $2)
          )
          SELECT *,
                 SUM(gross_inr - charges_inr) OVER (PARTITION BY client_id, strategy_id, left(expiry, 7)) AS combined_pl_inr
          FROM r
          ORDER BY left(expiry, 7) DESC, underlying
        `, [cl.id, strategyId])
      : await query(`
          WITH r AS (
            SELECT t.trade_date::text, t.client_id, t.strategy_id, t.underlying, t.contract, t.direction,
                   t.expiry::text,
                   t.lots, t.lot_size,
                   t.entry_price::float AS entry_price,
                   t.exit_price::float  AS exit_price,
                   t.regime,
                   (CASE WHEN t.direction = 'LONG'
                        THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
                        ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size
                   END)::float * $1        AS gross_inr,
                   tc.total_paise / 100.0 * $1 AS charges_inr
            FROM trades t
            JOIN trade_charges tc ON tc.trade_id = t.id
            WHERE ($2::date IS NULL OR t.trade_date >= $2::date)
          )
          SELECT *,
                 SUM(gross_inr - charges_inr) OVER (PARTITION BY client_id, strategy_id, left(expiry, 7)) AS combined_pl_inr
          FROM r
          ORDER BY left(expiry, 7) DESC, underlying
        `, [scale, joinDate])

    // Open positions (latest expiry)
    const { rows: posRows } = hasDirect
      ? await query(`
          SELECT t.underlying, t.contract, t.expiry::text, t.direction,
                 t.lots, t.lot_size, t.entry_price::float
          FROM trades t
          WHERE t.client_id = $1
            AND ($2::int IS NULL OR t.strategy_id = $2)
            AND t.expiry = (
              SELECT MAX(expiry) FROM trades
              WHERE client_id = $1
                AND ($2::int IS NULL OR strategy_id = $2)
            )
          ORDER BY t.underlying
        `, [cl.id, strategyId])
      : await query(`
          SELECT t.underlying, t.contract, t.expiry::text, t.direction,
                 t.lots, t.lot_size, t.entry_price::float
          FROM trades t
          WHERE ($1::date IS NULL OR t.trade_date >= $1::date)
            AND t.expiry = (
              SELECT MAX(expiry) FROM trades
              WHERE ($1::date IS NULL OR trade_date >= $1::date)
            )
          ORDER BY t.underlying
        `, [joinDate])

    // Lifetime charges
    const { rows: chRow } = hasDirect
      ? await query(`
          SELECT COALESCE(SUM(tc.stt_paise),   0) / 100.0 AS stt,
                 COALESCE(SUM(tc.exchange_paise),0) / 100.0 AS exch,
                 COALESCE(SUM(tc.sebi_paise),  0) / 100.0 AS sebi,
                 COALESCE(SUM(tc.stamp_paise), 0) / 100.0 AS stamp,
                 COALESCE(SUM(tc.gst_paise),   0) / 100.0 AS gst,
                 COALESCE(SUM(tc.total_paise), 0) / 100.0 AS total
          FROM trade_charges tc
          JOIN trades t ON t.id = tc.trade_id
          WHERE t.client_id = $1
            AND ($2::int IS NULL OR t.strategy_id = $2)
        `, [cl.id, strategyId])
      : await query(`
          SELECT COALESCE(SUM(tc.stt_paise),   0) / 100.0 * $1 AS stt,
                 COALESCE(SUM(tc.exchange_paise),0) / 100.0 * $1 AS exch,
                 COALESCE(SUM(tc.sebi_paise),  0) / 100.0 * $1 AS sebi,
                 COALESCE(SUM(tc.stamp_paise), 0) / 100.0 * $1 AS stamp,
                 COALESCE(SUM(tc.gst_paise),   0) / 100.0 * $1 AS gst,
                 COALESCE(SUM(tc.total_paise), 0) / 100.0 * $1 AS total
          FROM trade_charges tc
          JOIN trades t ON t.id = tc.trade_id
          WHERE ($2::date IS NULL OR t.trade_date >= $2::date)
        `, [scale, joinDate])
    const ch = chRow[0]

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
      joined_at: primaryStrategy?.joined_at || null,
      strategies: strategies.map(s => ({
        code: s.code,
        name: s.name,
        joined_at: s.joined_at,
        allocation_cr: +s.allocation_cr,
        exposure_cr: +s.exposure_cr,
        leverage: +s.leverage,
      })),
      stats: {
        net_inr:         Math.round(totalNet),
        net_cr:          +(totalNet / CR).toFixed(2),
        return_pct:      returnPct(totalNet),
        gross_inr:       Math.round(monthly.reduce((s, m) => s + +m.gross_inr, 0)),
        charges_inr:     Math.round(+ch.total || 0),
        sharpe:          sharpe(netByMonth, capitalBaseInr),
        win_rate:        monthly.length ? +(wins / monthly.length * 100).toFixed(1) : 0,
        wins,
        total_months:    monthly.length,
        max_dd_pct:      pairReferenceStats.max_dd_pct || maxDrawdown(cumArr),
        pair_max_dd_pct: pairReferenceStats.max_dd_pct || maxDrawdown(cumArr),
        best_month_inr:  Math.round(netArr.length ? Math.max(...netArr) : 0),
        worst_month_inr: Math.round(netArr.length ? Math.min(...netArr) : 0),
      },
      monthly: monthly.map(m => ({
        month:          m.month,
        gross_inr:      Math.round(+m.gross_inr),
        charges_inr:    Math.round(+m.charges_inr),
        net_inr:        Math.round(+m.net_inr),
        cumulative_inr: Math.round(+m.cumulative_inr),
        pct:            returnPct(+m.net_inr),
      })),
      recent_trades: recent.map(r => ({
        date:        r.trade_date,
        expiry:      r.expiry,
        underlying:  r.underlying,
        contract:    r.contract,
        direction:   r.direction,
        lots:        r.lots,
        lot_size:    r.lot_size,
        entry:       +r.entry_price,
        exit:        +r.exit_price,
        regime:      r.regime,
        gross_inr:   Math.round(+r.gross_inr),
        charges_inr: Math.round(+r.charges_inr),
        net_inr:     Math.round(+r.gross_inr - +r.charges_inr),
        combined_pl_inr: Math.round(+r.combined_pl_inr),
        combined_pct: returnPct(+r.combined_pl_inr),
      })),
      positions: posRows.map(p => ({
        underlying:  p.underlying,
        contract:    p.contract,
        expiry:      p.expiry,
        direction:   p.direction,
        lots:        p.lots,
        lot_size:    p.lot_size,
        entry_price: +p.entry_price,
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
