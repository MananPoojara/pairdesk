import { query } from '../db/pg.js'

const CR = 1e7

export async function ordersHandler(req, reply) {
  const { rows: trades } = await query(`
    WITH r AS (
      SELECT
        t.trade_date::text,
        t.client_id,
        t.strategy_id,
        c.name        AS client_name,
        c.code        AS client_code,
        c.category,
        COALESCE(NULLIF(cs.allocation_paise, 0), c.aum_paise)::float / 100.0 AS allocation_inr,
        t.underlying,
        t.contract,
        t.expiry::text,
        t.direction,
        t.lots,
        t.lot_size,
        t.entry_price::float,
        t.exit_price::float,
        t.regime,
        t.leg,
        CASE WHEN t.direction = 'LONG'
             THEN (t.exit_price  - t.entry_price) * t.lots * t.lot_size
             ELSE (t.entry_price - t.exit_price)  * t.lots * t.lot_size
        END::float                    AS gross_inr,
        (t.entry_price + t.exit_price) * t.lots * t.lot_size AS turnover_inr,
        tc.stt_paise      / 100.0     AS stt_inr,
        tc.exchange_paise / 100.0     AS exch_inr,
        tc.sebi_paise     / 100.0     AS sebi_inr,
        tc.stamp_paise    / 100.0     AS stamp_inr,
        tc.gst_paise      / 100.0     AS gst_inr,
        tc.total_paise    / 100.0     AS charges_inr
      FROM trades t
      JOIN clients c       ON c.id  = t.client_id
      JOIN trade_charges tc ON tc.trade_id = t.id
      LEFT JOIN client_strategies cs ON cs.client_id = t.client_id AND cs.strategy_id = t.strategy_id
    )
    SELECT *,
           -- A pair's two legs (MIDCPNIFTY + NIFTY) share an EXPIRY MONTH, not an entry date —
           -- they roll on independent contract schedules — so pair by expiry month.
           SUM(gross_inr - charges_inr) OVER (PARTITION BY client_id, strategy_id, left(expiry, 7)) AS combined_pl_inr
    FROM r
    ORDER BY left(expiry, 7) DESC, underlying
  `)

  const totalGross   = trades.reduce((s, t) => s + +t.gross_inr,    0)
  const totalCharges = trades.reduce((s, t) => s + +t.charges_inr,  0)
  const totalTurnover= trades.reduce((s, t) => s + +t.turnover_inr, 0)
  const byUnderlying = trades.reduce((acc, t) => {
    const key = t.underlying === 'MIDCPNIFTY' ? 'midcap' : 'nifty'
    acc[key].gross_inr += +t.gross_inr
    acc[key].charges_inr += +t.charges_inr
    acc[key].net_inr += +t.gross_inr - +t.charges_inr
    return acc
  }, {
    nifty: { gross_inr: 0, charges_inr: 0, net_inr: 0 },
    midcap: { gross_inr: 0, charges_inr: 0, net_inr: 0 },
  })

  return {
    summary: {
      count:        trades.length,
      gross_inr:    Math.round(totalGross),
      gross_cr:     +(totalGross   / CR).toFixed(2),
      charges_inr:  Math.round(totalCharges),
      charges_cr:   +(totalCharges / CR).toFixed(2),
      net_inr:      Math.round(totalGross - totalCharges),
      net_cr:       +((totalGross - totalCharges) / CR).toFixed(2),
      combined_pl_inr: Math.round(totalGross - totalCharges),
      combined_pl_cr:  +((totalGross - totalCharges) / CR).toFixed(2),
      nifty_net_inr:   Math.round(byUnderlying.nifty.net_inr),
      nifty_net_cr:    +(byUnderlying.nifty.net_inr / CR).toFixed(2),
      midcap_net_inr:  Math.round(byUnderlying.midcap.net_inr),
      midcap_net_cr:   +(byUnderlying.midcap.net_inr / CR).toFixed(2),
      turnover_inr: Math.round(totalTurnover),
      turnover_cr:  +(totalTurnover / CR).toFixed(2),
    },
    trades: trades.map(t => {
      const qty       = t.lots * t.lot_size
      const grossInr  = +t.gross_inr
      const chargesInr= +t.charges_inr
      const points    = t.direction === 'LONG'
        ? +t.exit_price - +t.entry_price
        : +t.entry_price - +t.exit_price
      return {
        date:        t.trade_date,
        client_name: t.client_name,
        client_code: t.client_code,
        category:    t.category,
        underlying:  t.underlying,
        contract:    t.contract,
        expiry:      t.expiry,
        direction:   t.direction,
        regime:      t.regime,
        lots:        t.lots,
        lot_size:    t.lot_size,
        qty,
        entry:       +t.entry_price,
        exit:        +t.exit_price,
        points:      +points.toFixed(2),
        gross_inr:   Math.round(grossInr),
        charges_inr: Math.round(chargesInr),
        net_inr:     Math.round(grossInr - chargesInr),
        combined_pl_inr: Math.round(+t.combined_pl_inr),
        combined_pct: +((+t.combined_pl_inr / (+t.allocation_inr || 1)) * 100).toFixed(3),
        turnover_inr:Math.round(+t.turnover_inr),
        stt_inr:     Math.round(+t.stt_inr),
        exch_inr:    Math.round(+t.exch_inr),
        sebi_inr:    Math.round(+t.sebi_inr),
        stamp_inr:   Math.round(+t.stamp_inr),
        gst_inr:     Math.round(+t.gst_inr),
      }
    }),
  }
}
