import { pool } from '../db/pg.js'

const CR_TO_PAISE = 1_000_000_000
const MAX_CAPITAL_CR = 100_000
const MAX_LEVERAGE = 10

const toPaise = cr => Math.round(Number(cr) * CR_TO_PAISE)

export async function createClientHandler(req, reply) {
  const b = req.body || {}

  // ── Validate ──────────────────────────────────────────────────────────────
  const name = String(b.name || '').trim()
  if (!name) return reply.code(400).send({ error: 'name is required.' })
  if (name.length > 100) return reply.code(400).send({ error: 'name too long.' })

  let code = String(b.code || '').trim().toUpperCase()
  if (!code) return reply.code(400).send({ error: 'code is required.' })
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) return reply.code(400).send({ error: 'code must be 2–32 chars, letters/numbers/_ only.' })

  const category = String(b.category || '').trim()
  if (!['Retail', 'HNI', 'Institution'].includes(category)) return reply.code(400).send({ error: 'category must be Retail, HNI, or Institution.' })

  const aumCr = Number(b.aum_cr)
  if (!Number.isFinite(aumCr) || aumCr <= 0 || aumCr > MAX_CAPITAL_CR) return reply.code(400).send({ error: 'aum_cr must be > 0.' })

  const allocationCr = b.allocation_cr != null ? Number(b.allocation_cr) : aumCr
  if (!Number.isFinite(allocationCr) || allocationCr < 0 || allocationCr > aumCr) return reply.code(400).send({ error: 'allocation_cr must be between 0 and aum_cr.' })

  let exposureCr = b.exposure_cr != null ? Number(b.exposure_cr) : allocationCr
  if (!Number.isFinite(exposureCr) || exposureCr < 0) return reply.code(400).send({ error: 'exposure_cr must be >= 0.' })
  if (allocationCr === 0 && exposureCr > 0) return reply.code(400).send({ error: 'exposure_cr must be 0 when allocation_cr is 0.' })

  let leverage = allocationCr > 0 ? +(exposureCr / allocationCr).toFixed(4) : 0
  if (leverage > MAX_LEVERAGE) return reply.code(400).send({ error: `Leverage cannot exceed ${MAX_LEVERAGE}×.` })

  const strategyCode = String(b.strategy_code || 'MIDCAP_NIFTY_PAIR').trim().toUpperCase()

  const joinedAt = b.joined_at ? new Date(b.joined_at) : new Date()
  if (isNaN(joinedAt.getTime())) return reply.code(400).send({ error: 'Invalid joined_at date.' })

  const brokeragePct = b.brokerage_pct != null ? Number(b.brokerage_pct) : 0
  const taxPct = b.tax_pct != null ? Number(b.tax_pct) : 0
  if (!Number.isFinite(brokeragePct) || brokeragePct < 0 || brokeragePct > 100) return reply.code(400).send({ error: 'brokerage_pct must be between 0 and 100.' })
  if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100) return reply.code(400).send({ error: 'tax_pct must be between 0 and 100.' })

  // ── Persist ───────────────────────────────────────────────────────────────
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Check code uniqueness
    const { rows: existing } = await client.query('SELECT id FROM clients WHERE UPPER(code) = $1', [code])
    if (existing.length) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: `Client code "${code}" already exists.` })
    }

    // Insert client (clients table has no joined_at — that lives on client_strategies)
    const { rows: [cl] } = await client.query(`
      INSERT INTO clients (code, name, category, aum_paise, brokerage_pct, tax_pct, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING id, code, name, category, aum_paise, brokerage_pct, tax_pct
    `, [code, name, category, toPaise(aumCr), brokeragePct, taxPct])

    // Look up strategy
    const { rows: strategies } = await client.query(
      `SELECT id FROM strategies WHERE UPPER(code) = $1`, [strategyCode]
    )
    if (!strategies.length) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: `Strategy "${strategyCode}" not found.` })
    }
    const strategyId = strategies[0].id

    // Insert client_strategies
    await client.query(`
      INSERT INTO client_strategies (client_id, strategy_id, allocation_paise, exposure_paise, leverage, joined_at, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    `, [cl.id, strategyId, toPaise(allocationCr), toPaise(exposureCr), leverage, joinedAt])

    await client.query('COMMIT')

    return reply.code(201).send({
      client: {
        code: cl.code,
        name: cl.name,
        category: cl.category,
        aum_cr: aumCr,
        allocation_cr: allocationCr,
        exposure_cr: exposureCr,
        leverage,
        brokerage_pct: brokeragePct,
        tax_pct: taxPct,
      },
    })
  } catch (err) {
    await client.query('ROLLBACK')
    req.log.error(err)
    return reply.code(500).send({ error: 'Could not create client.' })
  } finally {
    client.release()
  }
}
