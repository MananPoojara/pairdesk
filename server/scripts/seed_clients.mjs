// Seed ~30 realistic clients (HNI / Institution / Retail) as the showcase roster.
// All are DERIVED (no direct trades) — clients.js scales the 30 Cr platform blueprint by each
// client's deployed capital (allocation × leverage). The hidden inactive TEST (id 19) keeps the
// 52 trades as the 30 Cr reference book. Idempotent: upserts by code, re-runnable for Neon.
//
//   (local)  node server/scripts/seed_clients.mjs
//   (Neon)   DATABASE_URL='postgres://…' node server/scripts/seed_clients.mjs
import { pool } from '../src/db/pg.js'

const CR = 1_000_000_000                       // 1 Cr = 1e9 paise
const paise = cr => Math.round(cr * CR)

// pledgeFrac: stock pledge share of capital (rest is cash). Retail = 0 (all cash).
// F2F 2 / F2O 4 for Institute; ~35% F2F / 65% F2O for HNI + Retail. Leverage cycles 1×/2×/3×.
const INSTITUTION = [
  { name: 'Ashford Capital',        cap: 50, lev: 2, type: 'F2O', brok: 0.50, pledge: 0.50, joined: '2024-04-02' },
  { name: 'Meridian Partners',      cap: 35, lev: 3, type: 'F2O', brok: 0.05, pledge: 0.60, joined: '2024-05-14' },
  { name: 'Northcrest Holdings',    cap: 25, lev: 1, type: 'F2F', brok: 0.50, pledge: 0.50, joined: '2024-06-20' },
  { name: 'Vantage Securities',     cap: 20, lev: 2, type: 'F2O', brok: 0.05, pledge: 0.60, joined: '2024-07-11' },
  { name: 'Halcyon Asset Mgmt',     cap: 15, lev: 3, type: 'F2F', brok: 0.50, pledge: 0.50, joined: '2024-08-05' },
  { name: 'Cerulean Investments',   cap: 10, lev: 1, type: 'F2O', brok: 0.05, pledge: 0.60, joined: '2024-09-16' },
]

const HNI = [
  { name: 'Rajesh Agarwal',   cap: 2.00, lev: 3, type: 'F2F', brok: 0.50, pledge: 0.60, joined: '2024-05-03' },
  { name: 'Priya Nair',       cap: 1.75, lev: 2, type: 'F2O', brok: 0.05, pledge: 0.50, joined: '2024-06-18' },
  { name: 'Vikram Malhotra',  cap: 1.50, lev: 1, type: 'F2O', brok: 0.50, pledge: 0.60, joined: '2024-07-22' },
  { name: 'Anjali Deshpande', cap: 1.30, lev: 3, type: 'F2F', brok: 0.05, pledge: 0.50, joined: '2024-08-09' },
  { name: 'Sanjay Kapoor',    cap: 1.25, lev: 2, type: 'F2O', brok: 0.50, pledge: 0.60, joined: '2024-09-27' },
  { name: 'Meera Iyer',       cap: 1.15, lev: 1, type: 'F2O', brok: 0.05, pledge: 0.50, joined: '2024-10-14' },
  { name: 'Arjun Reddy',      cap: 1.10, lev: 3, type: 'F2F', brok: 0.50, pledge: 0.60, joined: '2024-11-06' },
  { name: 'Kavita Bhatia',    cap: 1.00, lev: 2, type: 'F2O', brok: 0.05, pledge: 0.50, joined: '2024-12-02' },
]

const RETAIL_CAPS = [0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.28, 0.75, 0.25]
const RETAIL_NAMES = [
  'Amit Sharma', 'Sneha Patil', 'Rohit Verma', 'Deepika Rao', 'Karan Mehta', 'Pooja Gupta',
  'Nikhil Joshi', 'Ritu Singh', 'Suresh Menon', 'Anita Desai', 'Manoj Kumar', 'Divya Pillai',
  'Rahul Shetty', 'Neha Kulkarni', 'Gaurav Saxena', 'Shweta Chauhan',
]
// ~35% F2F (indices 0,3,6,9,12,15 → 6 of 16), rest F2O. Leverage cycles 1/2/3.
const RETAIL = RETAIL_CAPS.map((cap, i) => ({
  name: RETAIL_NAMES[i], cap,
  lev: [1, 2, 3][i % 3],
  type: i % 3 === 0 ? 'F2F' : 'F2O',
  brok: 0,                       // Retail: no brokerage
  pledge: 0,                     // Retail: all cash
  joined: `2024-${String(1 + (i % 11)).padStart(2, '0')}-${String(3 + (i % 25)).padStart(2, '0')}`,
}))

const ALL = [
  ...INSTITUTION.map(c => ({ ...c, category: 'Institution' })),
  ...HNI.map(c => ({ ...c, category: 'HNI' })),
  ...RETAIL.map(c => ({ ...c, category: 'Retail' })),
]

const codeFromName = n => n.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24)

const db = await pool.connect()
try {
  await db.query('BEGIN')

  const { rows: strat } = await db.query(`SELECT id FROM strategies WHERE code = 'MIDCAP_NIFTY_PAIR'`)
  if (!strat.length) throw new Error('strategy MIDCAP_NIFTY_PAIR not found')
  const strategyId = strat[0].id

  // Hidden 30 Cr blueprint book keeps the trades (id 19 = TEST). Rename for clean dashboard positions.
  await db.query(`UPDATE clients SET name = 'House Book', is_active = FALSE WHERE code = 'TEST'`)
  // Retire the old demo clients so only the new roster shows.
  await db.query(`UPDATE clients SET is_active = FALSE WHERE code IN ('TES_SEC', 'NIK_SEC')`)

  let n = 0
  for (const c of ALL) {
    const code = codeFromName(c.name)
    const cashCr = +(c.cap * (1 - c.pledge)).toFixed(4)
    const pledgeCr = +(c.cap * c.pledge).toFixed(4)
    const expoCr = +(c.cap * c.lev).toFixed(4)

    const { rows: [cl] } = await db.query(`
      INSERT INTO clients (code, name, category, aum_paise, brokerage_pct, tax_pct, exec_type, is_active)
      VALUES ($1,$2,$3,$4,$5,0,$6,TRUE)
      ON CONFLICT (code) DO UPDATE SET
        name=EXCLUDED.name, category=EXCLUDED.category, aum_paise=EXCLUDED.aum_paise,
        brokerage_pct=EXCLUDED.brokerage_pct, exec_type=EXCLUDED.exec_type, is_active=TRUE
      RETURNING id`, [code, c.name, c.category, paise(c.cap), c.brok, c.type])

    await db.query(`
      INSERT INTO client_strategies (client_id, strategy_id, allocation_paise, exposure_paise, leverage, cash_paise, pledge_paise, joined_at, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
      ON CONFLICT (client_id, strategy_id) DO UPDATE SET
        allocation_paise=EXCLUDED.allocation_paise, exposure_paise=EXCLUDED.exposure_paise,
        leverage=EXCLUDED.leverage, cash_paise=EXCLUDED.cash_paise, pledge_paise=EXCLUDED.pledge_paise,
        joined_at=EXCLUDED.joined_at, is_active=TRUE`,
      [cl.id, strategyId, paise(c.cap), paise(expoCr), c.lev, paise(cashCr), paise(pledgeCr), c.joined])
    n++
  }

  await db.query('COMMIT')
  const { rows: [{ cnt }] } = await db.query(`SELECT COUNT(*)::int cnt FROM clients WHERE is_active`)
  const { rows: [{ sum }] } = await db.query(`SELECT COALESCE(SUM(aum_paise),0)/1e9 AS sum FROM clients WHERE is_active`)
  console.log(`seeded ${n} clients · ${cnt} active · total capital ₹${Number(sum).toFixed(2)} Cr`)
} catch (e) {
  await db.query('ROLLBACK')
  console.error('seed failed:', e.message)
  process.exitCode = 1
} finally {
  db.release()
  process.exit(process.exitCode || 0)
}
