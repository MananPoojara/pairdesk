import { pool } from '../db/pg.js'

const CR_TO_PAISE = 1_000_000_000
const MAX_CAPITAL_CR = 100_000
const MAX_LEVERAGE = 10
const CODE_RE = /^[A-Z0-9_-]{2,32}$/

const toPaise = value => Math.round(value * CR_TO_PAISE)
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function parseClientUpdate(params, body) {
  const currentCode = String(params?.code || '').trim().toUpperCase()
  if (!CODE_RE.test(currentCode)) return { ok: false, status: 400, error: 'Invalid current client code.' }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Request body must be an object.' }
  }
  const code = String(body.code || '').trim().toUpperCase()
  const name = String(body.name || '').trim()
  const category = String(body.category || '').trim()
  const execType = String(body.exec_type || '').trim().toUpperCase()
  const joinedAt = String(body.joined_at || '').slice(0, 10)
  const strategyCode = String(body.strategy_code || 'MIDCAP_NIFTY_PAIR').trim().toUpperCase()
  if (!CODE_RE.test(code)) return { ok: false, status: 400, error: 'Invalid client code.' }
  if (!name || name.length > 100) return { ok: false, status: 400, error: 'name is required and must be at most 100 characters.' }
  if (!['Retail', 'HNI', 'Institution'].includes(category)) return { ok: false, status: 400, error: 'Invalid category.' }
  if (!['F2F', 'F2O'].includes(execType)) return { ok: false, status: 400, error: 'Invalid execution type.' }
  if (!validDate(joinedAt)) return { ok: false, status: 400, error: 'Invalid joined_at date.' }
  if (!/^[A-Z0-9_ -]{2,64}$/.test(strategyCode)) return { ok: false, status: 400, error: 'Invalid strategy code.' }

  const aumCr = Number(body.aum_cr)
  const allocationCr = Number(body.allocation_cr)
  const exposureCr = Number(body.exposure_cr)
  const cashCr = Number(body.cash_cr)
  const pledgeCr = Number(body.pledge_cr)
  const brokeragePct = Number(body.brokerage_pct)
  const taxPct = Number(body.tax_pct)
  if (!Number.isFinite(aumCr) || aumCr <= 0 || aumCr > MAX_CAPITAL_CR) return { ok: false, status: 400, error: 'Invalid total capital.' }
  if (!Number.isFinite(allocationCr) || allocationCr <= 0 || allocationCr > aumCr) return { ok: false, status: 400, error: 'Invalid allocation.' }
  if (!Number.isFinite(exposureCr) || exposureCr < 0) return { ok: false, status: 400, error: 'Invalid exposure.' }
  if (![cashCr, pledgeCr].every(n => Number.isFinite(n) && n >= 0) || Math.abs(cashCr + pledgeCr - allocationCr) > 0.011) {
    return { ok: false, status: 400, error: 'Cash + stock pledge must equal allocation.' }
  }
  const leverage = exposureCr / allocationCr
  if (!Number.isFinite(leverage) || leverage < 0 || leverage > MAX_LEVERAGE) return { ok: false, status: 400, error: 'Leverage must be between 0 and 10.' }
  if (![brokeragePct, taxPct].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) {
    return { ok: false, status: 400, error: 'Brokerage and tax must be between 0 and 100.' }
  }
  return {
    ok: true,
    value: {
      currentCode, code, name, category, execType, joinedAt, strategyCode,
      aumCr, allocationCr, exposureCr, cashCr, pledgeCr, brokeragePct, taxPct,
      leverage: +leverage.toFixed(4),
      aumPaise: toPaise(aumCr), allocationPaise: toPaise(allocationCr),
      exposurePaise: toPaise(exposureCr), cashPaise: toPaise(cashCr), pledgePaise: toPaise(pledgeCr),
    },
  }
}

export async function updateClientHandler(req, reply) {
  const parsed = parseClientUpdate(req.params, req.body)
  if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error })
  const i = parsed.value
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const duplicate = await client.query(
      `SELECT 1 FROM clients WHERE UPPER(code) = $1 AND UPPER(code) <> $2 LIMIT 1`,
      [i.code, i.currentCode],
    )
    if (duplicate.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: `Client code "${i.code}" already exists.` })
    }
    const updated = await client.query(`
      UPDATE clients SET code=$1, name=$2, category=$3, aum_paise=$4,
        brokerage_pct=$5, tax_pct=$6, exec_type=$7
      WHERE UPPER(code)=$8 AND is_active=TRUE
      RETURNING id
    `, [i.code, i.name, i.category, i.aumPaise, i.brokeragePct, i.taxPct, i.execType, i.currentCode])
    if (!updated.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'Active client not found.' })
    }
    const strategy = await client.query(`
      SELECT cs.id, cs.strategy_id
      FROM client_strategies cs JOIN strategies s ON s.id=cs.strategy_id
      WHERE cs.client_id=$1 AND cs.is_active=TRUE AND UPPER(s.code)=$2
    `, [updated.rows[0].id, i.strategyCode])
    if (strategy.rowCount !== 1) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'Active client strategy not found.' })
    }
    await client.query(`
      UPDATE client_strategies SET allocation_paise=$1, exposure_paise=$2, leverage=$3,
        cash_paise=$4, pledge_paise=$5, joined_at=$6
      WHERE id=$7
    `, [i.allocationPaise, i.exposurePaise, i.leverage, i.cashPaise, i.pledgePaise, i.joinedAt, strategy.rows[0].id])

    const events = await client.query(`
      SELECT COALESCE(SUM(CASE WHEN type='PAY_IN' THEN amount_paise ELSE -amount_paise END),0)::bigint AS balance,
             COUNT(*)::int AS count
      FROM capital_events WHERE client_id=$1
    `, [updated.rows[0].id])
    const balance = Number(events.rows[0].balance)
    if (events.rows[0].count > 0 && balance !== i.allocationPaise) {
      const diff = i.allocationPaise - balance
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
      await client.query(`
        INSERT INTO capital_events (client_id, strategy_id, effective_date, type, amount_paise, ref)
        VALUES ($1,$2,$3,$4,$5,'client edit adjustment')
      `, [updated.rows[0].id, strategy.rows[0].strategy_id, today, diff > 0 ? 'PAY_IN' : 'PAY_OUT', Math.abs(diff)])
    }
    await client.query('COMMIT')
    return { client: { code: i.code, name: i.name } }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error?.code === '23505') {
      return reply.code(409).send({ error: `Client code "${i.code}" already exists.` })
    }
    req.log.error(error)
    return reply.code(500).send({ error: 'Could not update client.' })
  } finally {
    client.release()
  }
}
