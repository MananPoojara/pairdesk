import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { pool } from './db/pg.js'
import { duckQuery, PARQUET } from './db/duck.js'
import { dashboardHandler } from './routes/dashboard.js'
import { clientsHandler } from './routes/clients.js'
import { ordersHandler  } from './routes/orders.js'
import { strategiesHandler } from './routes/strategies.js'
import { updateClientCapitalHandler } from './routes/clientCapital.js'
import { createClientHandler } from './routes/createClient.js'
import { deactivateClientHandler } from './routes/deactivateClient.js'

const PORT = Number(process.env.PORT) || 3002

const app = Fastify({ logger: { level: 'info' } })

await app.register(cors, { origin: '*' })

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', async () => {
  const { rows } = await pool.query('SELECT NOW() AS ts')
  return { status: 'ok', pg: rows[0].ts }
})

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', dashboardHandler)
app.get('/api/clients', clientsHandler)
app.post('/api/clients', createClientHandler)
app.patch('/api/clients/:code/capital', updateClientCapitalHandler)
app.delete('/api/clients/:code', deactivateClientHandler)
app.get('/api/orders',  ordersHandler)
app.get('/api/strategies', strategiesHandler)

// ── Parquet probe (DuckDB) ────────────────────────────────────────────────────
app.get('/api/data-summary', async () => {
  const rows = await duckQuery(`
    SELECT underlying,
           count(*)         AS row_count,
           min(date)::TEXT  AS first_date,
           max(date)::TEXT  AS last_date,
           count(DISTINCT contract) AS contracts
    FROM read_parquet('${PARQUET.fut}')
    GROUP BY underlying ORDER BY underlying
  `)
  return { source: 'fut_bars.parquet', data: rows }
})

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[pairdesk] server running on http://0.0.0.0:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
