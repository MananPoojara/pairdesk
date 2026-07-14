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
console.log('schema columns ensured')

await import('./seed_clients.mjs')                      // seeds 30 clients against the same Neon pool
