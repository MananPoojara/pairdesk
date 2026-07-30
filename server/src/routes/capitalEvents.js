import { query, pool } from '../db/pg.js'

const CR_TO_PAISE = 1_000_000_000

// Record a pay-in / pay-out (admin bookkeeping — the money moved in the real world via bank/broker;
// this just journals it). Appends to capital_events AND syncs the client's cached snapshot
// (aum/allocation/exposure/cash/pledge) to the new running balance so display + the no-event fallback
// stay correct. Body: { client_code, effective_date:'YYYY-MM-DD', type, amount_cr, ref? }.
export async function createCapitalEventHandler(req, reply) {
  const b = req.body || {}
  const code = String(b.client_code || '').trim().toUpperCase()
  const type = String(b.type || '').trim().toUpperCase()
  const date = String(b.effective_date || '').slice(0, 10)
  const amountCr = Number(b.amount_cr)
  const ref = b.ref ? String(b.ref).slice(0, 120) : (type === 'PAY_OUT' ? 'redemption' : 'capital added')

  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) return reply.code(400).send({ error: 'Invalid client code.' })
  if (type !== 'PAY_IN' && type !== 'PAY_OUT') return reply.code(400).send({ error: 'type must be PAY_IN or PAY_OUT.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'effective_date must be YYYY-MM-DD.' })
  if (!Number.isFinite(amountCr) || amountCr <= 0) return reply.code(400).send({ error: 'amount_cr must be > 0.' })
  const amountPaise = Math.round(amountCr * CR_TO_PAISE)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(`
      SELECT cl.id AS client_id, cs.id AS cs_id, cs.strategy_id,
             cs.allocation_paise, COALESCE(cs.leverage, 1) AS leverage,
             cs.cash_paise, cs.pledge_paise,
             to_char(cs.joined_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS joined
      FROM clients cl
      JOIN client_strategies cs ON cs.client_id = cl.id AND cs.is_active
      WHERE UPPER(cl.code) = $1 AND cl.is_active = TRUE
      ORDER BY cs.id LIMIT 1
    `, [code])
    if (!rows.length) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Active client not found.' }) }
    const c = rows[0]

    if (date < c.joined) { await client.query('ROLLBACK'); return reply.code(400).send({ error: `effective_date cannot be before the join date (${c.joined}).` }) }

    // Current running balance from the ledger (source of truth).
    const { rows: [{ bal }] } = await client.query(`
      SELECT COALESCE(SUM(CASE WHEN type='PAY_IN' THEN amount_paise ELSE -amount_paise END), 0)::bigint AS bal
      FROM capital_events WHERE client_id = $1
    `, [c.client_id])
    const balance = Number(bal)

    if (type === 'PAY_OUT' && amountPaise > balance) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: `Pay-out ₹${amountCr} Cr exceeds current balance ₹${(balance / CR_TO_PAISE).toFixed(2)} Cr.` })
    }

    await client.query(`
      INSERT INTO capital_events (client_id, strategy_id, effective_date, type, amount_paise, ref)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [c.client_id, c.strategy_id, date, type, amountPaise, ref])

    const newBal = balance + (type === 'PAY_OUT' ? -amountPaise : amountPaise)
    const lev = Number(c.leverage)
    const ratio = balance > 0 ? newBal / balance : 1
    const newCash = balance > 0 ? Math.round(Number(c.cash_paise) * ratio) : newBal
    const newPledge = balance > 0 ? Math.round(Number(c.pledge_paise) * ratio) : 0

    await client.query(`UPDATE clients SET aum_paise = $1 WHERE id = $2`, [newBal, c.client_id])
    await client.query(`
      UPDATE client_strategies
      SET allocation_paise = $1, exposure_paise = $2, cash_paise = $3, pledge_paise = $4
      WHERE id = $5
    `, [newBal, Math.round(newBal * lev), newCash, newPledge, c.cs_id])

    await client.query('COMMIT')
    return {
      ok: true,
      client_code: code,
      type,
      amount_cr: amountCr,
      new_balance_cr: +(newBal / CR_TO_PAISE).toFixed(2),
    }
  } catch (err) {
    await client.query('ROLLBACK')
    req.log.error(err)
    return reply.code(500).send({ error: 'Could not record capital event.' })
  } finally {
    client.release()
  }
}

// Pay-in / pay-out ledger for the History page — the same capital_events that drive the returns
// engine (single source of truth). Returns every event (newest-first for display) with a
// platform-wide running balance, plus headline totals.
export async function capitalEventsHandler(req, reply) {
  const { rows } = await query(`
    SELECT ce.id,
           to_char(ce.effective_date, 'DD Mon YY') AS date_disp,
           ce.effective_date::text                 AS date_iso,
           cl.name  AS client_name,
           cl.code  AS client_code,
           cl.category,
           ce.type,
           ce.amount_paise,
           ce.ref
    FROM capital_events ce
    JOIN clients cl ON cl.id = ce.client_id
    ORDER BY ce.effective_date ASC, ce.id ASC
  `)

  // Platform-wide running balance in chronological order.
  let bal = 0
  const chrono = rows.map(r => {
    const signed = r.type === 'PAY_OUT' ? -Number(r.amount_paise) : Number(r.amount_paise)
    bal += signed
    return { ...r, amount_paise: Number(r.amount_paise), running_paise: bal }
  })

  const payIn  = chrono.filter(r => r.type === 'PAY_IN').reduce((s, r) => s + r.amount_paise, 0)
  const payOut = chrono.filter(r => r.type === 'PAY_OUT').reduce((s, r) => s + r.amount_paise, 0)

  // Newest first for the table.
  const events = [...chrono].reverse().map(r => ({
    id: r.id,
    date_disp: r.date_disp,
    date_iso: r.date_iso,
    client_name: r.client_name,
    client_code: r.client_code,
    category: r.category,
    strategy: 'Pair Trading',
    index: 'Combined',
    type: r.type,
    amount_paise: r.amount_paise,
    running_paise: r.running_paise,
    ref: r.ref || '—',
  }))

  return {
    summary: {
      total_pay_in_paise: payIn,
      total_pay_out_paise: payOut,
      net_flow_paise: payIn - payOut,
      closing_paise: bal,
      count: chrono.length,
      first_date: chrono[0]?.date_disp || null,
      last_date: chrono[chrono.length - 1]?.date_disp || null,
    },
    events,
  }
}
