import { query } from '../db/pg.js'
import { capitalSchedule } from '../data/capitalSchedule.js'
import { buildClientOptionBook, optionPhase, OPTIONS_WINDOW_START } from '../data/optionLotCalc.js'
import { readLotSizeHistory } from '../data/lotSizeHistory.js'

// GET /api/clients/:id/options — the per-client OPTIONS book with real discrete lots, itemised charges,
// and margin (parity with the futures buildClientBook path). Computed on demand; the drawer fetches it
// only when the Options toggle is active. The 30 Cr headline (/api/option-trades) stays on the raw %-model.

export async function clientOptionsHandler(req, reply) {
  const code = req.params.code
  const { rows: cr } = await query(`SELECT id FROM clients WHERE code = $1`, [code])
  if (!cr.length) return reply.code(404).send({ error: 'client not found' })
  const clientId = cr[0].id

  // Client's primary strategy → leverage / exposure / join date.
  const { rows: strat } = await query(`
    SELECT cs.joined_at::text AS joined_at,
           COALESCE(cs.leverage, 1)::float AS leverage,
           ROUND(COALESCE(NULLIF(cs.exposure_paise, 0), cs.allocation_paise) / 1e9::numeric, 2)::float AS exposure_cr
    FROM client_strategies cs
    WHERE cs.client_id = $1 AND cs.is_active = TRUE
    ORDER BY cs.id LIMIT 1
  `, [clientId])
  if (!strat.length) return reply.code(404).send({ error: 'client has no active strategy' })
  const { joined_at: joinDate, leverage, exposure_cr: exposureCr } = strat[0]

  // Capital timeline (pay-in / pay-out) → exposure & capital in force at any date.
  const { rows: evs } = await query(`
    SELECT to_char(effective_date, 'YYYY-MM-DD') AS effective_date, type,
           amount_paise / 1e9::numeric AS amount_cr
    FROM capital_events WHERE client_id = $1
  `, [clientId])
  const events = evs.map(e => ({ effective_date: e.effective_date, type: e.type, amount_cr: Number(e.amount_cr) }))
  const sched = events.length ? capitalSchedule(events, leverage) : null
  const exposureAt = sched ? sched.exposureAt : () => exposureCr
  const capitalAt = sched ? sched.capitalAt : () => exposureCr / (leverage || 1)

  // The full options book (option leg joined to its midcap hedge leg).
  const { rows: rawTrades } = await query(`
    SELECT o.trade_no, o.entry_date::text AS entry_date, o.exit_date::text AS exit_date,
           o.expiry::text AS expiry, o.opt_type, o.strike::float AS strike, o.side,
           o.entry_spot::float AS entry_spot, o.entry_px::float AS opt_entry, o.exit_px::float AS opt_exit,
           o.pnl_pts::float AS opt_pts,
           o.stt_inr::float AS stt1, o.exch_inr::float AS exch1, o.sebi_inr::float AS sebi1,
           o.stamp_inr::float AS stamp1, o.gst_inr::float AS gst1, o.total_charges_inr::float AS total_ch1,
           f.side AS mid_side, f.entry_px::float AS mid_spot, f.pnl_pts::float AS mid_pts
    FROM option_trade_legs o
    JOIN option_trade_legs f ON f.trade_no = o.trade_no AND f.leg = 2
    WHERE o.leg = 1 AND o.entry_date >= $1
    ORDER BY o.entry_date, o.expiry
  `, [OPTIONS_WINDOW_START])
  const trades = rawTrades.map(t => ({ ...t, strategy: optionPhase(t.trade_no) }))   // strategy derived, not stored
  const maxExpiry = trades.reduce((mx, t) => (t.expiry > mx ? t.expiry : mx), '')

  const lotHistory = await readLotSizeHistory()
  const book = buildClientOptionBook(trades, { exposureAt, capitalAt, joinDate, maxExpiry, lotHistory })
  return {
    client_id: clientId, exposure_cr: exposureCr, leverage, base_aum_cr: 30,
    monthly: book.monthly, recent: book.recent, positions: book.positions,
    charges: book.charges, margin: book.margin,
  }
}
