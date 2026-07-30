// Apply the exec_type + cash/pledge schema columns AND seed the 30-client roster to the LIVE
// Neon production DB. Run this AFTER deploying the new code so prod /api/clients doesn't 500 on
// the new columns. Reads the connection string from .deploy.env (repo root, gitignored) and
// cleans it (Neon's escaped `\&` + channel_binding trip up node-postgres). Never prints the URL.
//
//   node server/scripts/migrate_neon.mjs
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV = join(HERE, '../../.deploy.env')            // repo-root/.deploy.env

const raw = readFileSync(ENV, 'utf8')
const m = raw.match(/DATABASE_URL\s*=\s*(.*)/)
if (!m) { console.error('no DATABASE_URL in .deploy.env'); process.exit(1) }
let url = m[1].trim().replace(/^["']|["']$/g, '').replace(/\\&/g, '&').replace(/\\/g, '')
url = url.replace(/([?&])channel_binding=[^&]*/g, '$1').replace(/[?&]+$/, '').replace(/&&+/g, '&').replace(/\?&/, '?')
url += (url.includes('?') ? '&' : '?') + 'channel_binding=disable'
process.env.DATABASE_URL = url
console.log('target host:', new URL(url).host)          // host only — never the full URL

const { pool } = await import('../src/db/pg.js')
const t = await pool.query('SELECT current_database() db')
console.log('connected to:', t.rows[0].db)

await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS exec_type TEXT NOT NULL DEFAULT 'F2F'`)
await pool.query(`ALTER TABLE client_strategies ADD COLUMN IF NOT EXISTS cash_paise BIGINT NOT NULL DEFAULT 0`)
await pool.query(`ALTER TABLE client_strategies ADD COLUMN IF NOT EXISTS pledge_paise BIGINT NOT NULL DEFAULT 0`)
// Capital timeline (pay-in / pay-out ledger) — source of truth for time-varying capital. Seed
// separately with scripts/seed_capital_events.mjs after this runs.
await pool.query(`
  CREATE TABLE IF NOT EXISTS capital_events (
    id             SERIAL PRIMARY KEY,
    client_id      INT  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    strategy_id    INT  REFERENCES strategies(id),
    effective_date DATE NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('PAY_IN','PAY_OUT')),
    amount_paise   BIGINT NOT NULL CHECK (amount_paise > 0),
    ref            TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_capital_events_client ON capital_events(client_id, effective_date)`)
// Editable charge/tax rates (Admin page) — seed if missing, never overwrite an existing value.
await pool.query(`
  INSERT INTO platform_settings (key, value) VALUES
    ('charge_exch_rate', '0.0000173'),
    ('charge_sebi_rate', '0.000001'),
    ('charge_stamp_rate', '0.0002'),
    ('charge_gst_rate', '0.18'),
    ('charge_stt_rate', '0.0005')
  ON CONFLICT (key) DO NOTHING`)
await pool.query(`
  CREATE TABLE IF NOT EXISTS lot_size_history (
    id BIGSERIAL PRIMARY KEY,
    underlying TEXT NOT NULL CHECK (underlying IN ('NIFTY','MIDCPNIFTY')),
    effective_date DATE NOT NULL,
    lot_size INT NOT NULL CHECK (lot_size > 0 AND lot_size <= 10000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (underlying, effective_date)
  )`)
await pool.query(`
  INSERT INTO lot_size_history (underlying, effective_date, lot_size) VALUES
    ('NIFTY','1900-01-01',25), ('NIFTY','2024-11-20',75), ('NIFTY','2025-12-30',65),
    ('MIDCPNIFTY','1900-01-01',50), ('MIDCPNIFTY','2024-11-20',120),
    ('MIDCPNIFTY','2025-04-25',140), ('MIDCPNIFTY','2025-10-28',120)
  ON CONFLICT (underlying, effective_date) DO NOTHING
`)
console.log('schema columns ensured')

await import('./seed_clients.mjs')                      // seeds 30 clients against the same Neon pool
