// Phase 0 — capital timeline source of truth.
// Creates the capital_events ledger (if missing) and seeds it: every active client gets an initial
// PAY_IN at their join date = current allocation (single segment → identical to today's behaviour).
// The scenario/demo client (Ashford, joined 2024-04-02) instead starts at half and tops up mid-life,
// so the capital-change engine has something visible to compute. Running balance is DERIVED (never
// stored) — the History ledger and the returns engine both read this table. Idempotent: re-runnable.
//
//   (local)  node server/scripts/seed_capital_events.mjs
//   (Neon)   DATABASE_URL='postgres://…' node server/scripts/seed_capital_events.mjs
import { pool } from '../src/db/pg.js'

const CR = 1_000_000_000
const paise = cr => Math.round(cr * CR)

// Demo overrides keyed by client code. Each list must sum (signed) to the client's current allocation
// so the latest running balance still reconciles with clients.aum_paise / client_strategies.allocation.
const DEMO = {
  // Pay-in demo: joined at 25 Cr, topped up to 50 Cr on 2025-06-05.
  ASHFORD_CAPITAL: [
    { date: '2024-04-02', type: 'PAY_IN', cr: 25, ref: 'RTGS · initial capital' },
    { date: '2025-06-05', type: 'PAY_IN', cr: 25, ref: 'RTGS · top-up' },
  ],
  // Pay-out demo: joined at 45 Cr, withdrew 10 Cr on 2025-09-10 → current 35 Cr.
  MERIDIAN_PARTNERS: [
    { date: '2024-05-14', type: 'PAY_IN', cr: 45, ref: 'RTGS · initial capital' },
    { date: '2025-09-10', type: 'PAY_OUT', cr: 10, ref: 'RTGS · partial redemption' },
  ],
}

const db = await pool.connect()
try {
  await db.query('BEGIN')

  await db.query(`
    CREATE TABLE IF NOT EXISTS capital_events (
      id             SERIAL PRIMARY KEY,
      client_id      INT  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      strategy_id    INT  REFERENCES strategies(id),
      effective_date DATE NOT NULL,
      type           TEXT NOT NULL CHECK (type IN ('PAY_IN','PAY_OUT')),
      amount_paise   BIGINT NOT NULL CHECK (amount_paise > 0),   -- always positive; direction = type
      ref            TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_capital_events_client ON capital_events(client_id, effective_date)`)

  await db.query(`DELETE FROM capital_events`)

  // joined date as clean IST text (joined_at is stored as an IST midnight timestamptz).
  const { rows: clients } = await db.query(`
    SELECT cl.id, cl.code, cs.strategy_id, cs.allocation_paise,
           to_char(cs.joined_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS joined
    FROM clients cl JOIN client_strategies cs ON cs.client_id = cl.id
    WHERE cl.is_active AND cs.is_active
    ORDER BY cl.id`)

  const ins = (client_id, strategy_id, date, type, amount_paise, ref) =>
    db.query(`INSERT INTO capital_events (client_id, strategy_id, effective_date, type, amount_paise, ref)
              VALUES ($1,$2,$3,$4,$5,$6)`, [client_id, strategy_id, date, type, amount_paise, ref])

  let ev = 0, demoN = 0
  for (const c of clients) {
    const demo = DEMO[c.code]
    if (demo) {
      for (const d of demo) { await ins(c.id, c.strategy_id, d.date, d.type, paise(d.cr), d.ref); ev++ }
      demoN++
    } else {
      await ins(c.id, c.strategy_id, c.joined, 'PAY_IN', Number(c.allocation_paise), 'seed · initial capital')
      ev++
    }
  }

  await db.query('COMMIT')

  // Verify: latest running balance per client must equal its allocation.
  const { rows: bad } = await db.query(`
    SELECT cl.code,
           cs.allocation_paise                                              AS alloc,
           SUM(CASE WHEN ce.type='PAY_IN' THEN ce.amount_paise ELSE -ce.amount_paise END) AS balance
    FROM clients cl
    JOIN client_strategies cs ON cs.client_id = cl.id AND cs.is_active
    JOIN capital_events ce     ON ce.client_id = cl.id
    WHERE cl.is_active
    GROUP BY cl.code, cs.allocation_paise
    HAVING SUM(CASE WHEN ce.type='PAY_IN' THEN ce.amount_paise ELSE -ce.amount_paise END) <> cs.allocation_paise`)

  console.log(`seeded ${ev} capital events across ${clients.length} clients (${demoN} with a mid-life change).`)
  if (bad.length) {
    console.error('RECONCILE MISMATCH (balance ≠ allocation):', bad.map(b => b.code).join(', '))
    process.exitCode = 1
  } else {
    console.log('reconcile OK: every client’s running balance = its allocation.')
  }

  const { rows: ash } = await db.query(`
    SELECT to_char(effective_date,'YYYY-MM-DD') AS d, type, amount_paise/1e9 AS cr, ref
    FROM capital_events ce JOIN clients cl ON cl.id=ce.client_id
    WHERE cl.code='ASHFORD_CAPITAL' ORDER BY effective_date`)
  console.log('Ashford timeline:', ash.map(r => `${r.d} ${r.type} ₹${r.cr}Cr`).join('  |  '))
} catch (e) {
  await db.query('ROLLBACK')
  console.error('seed failed:', e.message)
  process.exitCode = 1
} finally {
  db.release()
  process.exit(process.exitCode || 0)
}
