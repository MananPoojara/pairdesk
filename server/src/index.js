import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { pool } from './db/pg.js'
import { duckQuery, PARQUET } from './db/duck.js'
import { dashboardHandler } from './routes/dashboard.js'
import { getLiveMarket, startMinuteScheduler } from './data/liveMarket.js'
import { clientsHandler } from './routes/clients.js'
import { ordersHandler  } from './routes/orders.js'
import { strategiesHandler } from './routes/strategies.js'
import { optionTradesHandler } from './routes/optionTrades.js'
import { clientOptionsHandler } from './routes/clientOptions.js'
import { updateClientCapitalHandler } from './routes/clientCapital.js'
import { createClientHandler } from './routes/createClient.js'
import { deactivateClientHandler } from './routes/deactivateClient.js'
import { capitalEventsHandler, createCapitalEventHandler } from './routes/capitalEvents.js'
import { lotSizesHandler, createLotSizeHandler } from './routes/lotSizes.js'
import { updateClientHandler } from './routes/updateClient.js'
import { chargeConfigHandler, updateChargeConfigHandler } from './routes/chargeConfig.js'
import { loadRates } from './data/chargeConfig.js'

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
app.get('/api/tickers', async () => (await getLiveMarket()) || {})   // live index LTP (Angel One, 60s cache)
app.get('/api/clients', clientsHandler)
app.post('/api/clients', createClientHandler)
app.patch('/api/clients/:code', updateClientHandler)
app.patch('/api/clients/:code/capital', updateClientCapitalHandler)
app.delete('/api/clients/:code', deactivateClientHandler)
app.get('/api/orders',  ordersHandler)
app.get('/api/strategies', strategiesHandler)
app.get('/api/option-trades', optionTradesHandler)   // real F2O trade book (option_trades)
app.get('/api/clients/:code/options', clientOptionsHandler)   // per-client options book (real lots + charges + margin)
app.get('/api/capital-events', capitalEventsHandler) // pay-in / pay-out ledger (History page)
app.post('/api/capital-events', createCapitalEventHandler) // admin records a pay-in / pay-out
app.get('/api/lot-sizes', lotSizesHandler)
app.post('/api/lot-sizes', createLotSizeHandler)
app.get('/api/charge-config', chargeConfigHandler)
app.patch('/api/charge-config', updateChargeConfigHandler)

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
  await loadRates()   // charge/tax rates from platform_settings (falls back to defaults if unseeded)
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[pairdesk] server running on http://0.0.0.0:${PORT}`)
  // Fetch the live futures quote on each wall-clock minute close (HH:MM:00) — see liveMarket.js.
  // Also warms the cache immediately so the first request has data.
  startMinuteScheduler()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
