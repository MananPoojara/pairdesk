import { pool } from '../db/pg.js'

const CR_TO_PAISE = 1_000_000_000
const MAX_CAPITAL_CR = 100_000
const MAX_LEVERAGE = 10

function toPaiseFromCr(value) {
  return Math.round(value * CR_TO_PAISE)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseCapitalUpdate({ code }, body) {
  const normalizedCode = String(code || '').trim().toUpperCase()
  if (!/^[A-Z0-9_-]{2,32}$/.test(normalizedCode)) {
    return { ok: false, status: 400, error: 'Invalid client code.' }
  }
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, error: 'Request body must be an object.' }
  }

  const aumCr = Number(body.aum_cr)
  if (!Number.isFinite(aumCr) || aumCr <= 0 || aumCr > MAX_CAPITAL_CR) {
    return { ok: false, status: 400, error: `aum_cr must be > 0 and <= ${MAX_CAPITAL_CR}.` }
  }

  const hasAllocation = body.allocation_cr !== undefined && body.allocation_cr !== null && body.allocation_cr !== ''
  const allocationCr = hasAllocation ? Number(body.allocation_cr) : aumCr
  if (!Number.isFinite(allocationCr) || allocationCr < 0 || allocationCr > aumCr) {
    return { ok: false, status: 400, error: 'allocation_cr must be >= 0 and <= aum_cr.' }
  }

  const hasExposure = body.exposure_cr !== undefined && body.exposure_cr !== null && body.exposure_cr !== ''
  const hasLeverage = body.leverage !== undefined && body.leverage !== null && body.leverage !== ''
  let exposureCr = hasExposure ? Number(body.exposure_cr) : null
  let leverage = hasLeverage ? Number(body.leverage) : null

  if (hasExposure && (!Number.isFinite(exposureCr) || exposureCr < 0)) {
    return { ok: false, status: 400, error: 'exposure_cr must be >= 0.' }
  }
  if (hasLeverage && (!Number.isFinite(leverage) || leverage < 0 || leverage > MAX_LEVERAGE)) {
    return { ok: false, status: 400, error: `leverage must be >= 0 and <= ${MAX_LEVERAGE}.` }
  }
  if (!hasExposure && hasLeverage) exposureCr = allocationCr * leverage
  if (hasExposure || hasLeverage) {
    if (allocationCr === 0 && exposureCr > 0) {
      return { ok: false, status: 400, error: 'exposure_cr must be 0 when allocation_cr is 0.' }
    }
    leverage = allocationCr > 0 ? +(exposureCr / allocationCr).toFixed(4) : 0
    if (leverage > MAX_LEVERAGE) {
      return { ok: false, status: 400, error: `derived leverage must be <= ${MAX_LEVERAGE}.` }
    }
  } else {
    exposureCr = allocationCr
    leverage = allocationCr > 0 ? 1 : 0
  }

  const strategyCode = body.strategy_code === undefined || body.strategy_code === null || body.strategy_code === ''
    ? null
    : String(body.strategy_code).trim().toUpperCase()
  if (strategyCode && !/^[A-Z0-9_ -]{2,64}$/.test(strategyCode)) {
    return { ok: false, status: 400, error: 'Invalid strategy_code.' }
  }

  return {
    ok: true,
    value: {
      code: normalizedCode,
      aumCr,
      aumPaise: toPaiseFromCr(aumCr),
      allocationCr,
      allocationPaise: toPaiseFromCr(allocationCr),
      exposureCr,
      exposurePaise: toPaiseFromCr(exposureCr),
      leverage,
      strategyCode,
      strategyFieldsExplicit: hasAllocation || hasExposure || hasLeverage,
    },
  }
}

export async function updateClientCapitalHandler(req, reply) {
  const parsed = parseCapitalUpdate(req.params, req.body)
  if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error })

  const input = parsed.value
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const updated = await client.query(`
      UPDATE clients
      SET aum_paise = $1
      WHERE UPPER(code) = $2 AND is_active = TRUE
      RETURNING id, code, name, category, aum_paise
    `, [input.aumPaise, input.code])

    if (!updated.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'Active client not found.' })
    }

    const dbClient = updated.rows[0]

    // Is this client on the capital timeline? If so, a capital change must be journalled as a
    // pay-in/pay-out delta (dated today) so the ledger stays the source of truth — never a silent
    // overwrite. Clients with no events yet (e.g. just created in the UI) keep the direct set.
    const { rows: evAgg } = await client.query(`
      SELECT COALESCE(SUM(CASE WHEN type='PAY_IN' THEN amount_paise ELSE -amount_paise END), 0)::bigint AS bal,
             COUNT(*)::int AS n
      FROM capital_events WHERE client_id = $1
    `, [dbClient.id])
    const evBalance = Number(evAgg[0].bal)
    const hasEvents = evAgg[0].n > 0

    const strategyRows = input.strategyCode
      ? await client.query(`
          SELECT cs.id, cs.strategy_id, s.code
          FROM client_strategies cs
          JOIN strategies s ON s.id = cs.strategy_id
          WHERE cs.client_id = $1 AND cs.is_active = TRUE AND UPPER(s.code) = $2
        `, [dbClient.id, input.strategyCode])
      : await client.query(`
          SELECT cs.id, cs.strategy_id, s.code
          FROM client_strategies cs
          JOIN strategies s ON s.id = cs.strategy_id
          WHERE cs.client_id = $1 AND cs.is_active = TRUE
          ORDER BY cs.id
        `, [dbClient.id])

    let allocationUpdated = null
    if (strategyRows.rowCount === 1) {
      const strategy = strategyRows.rows[0]
      await client.query(`
        UPDATE client_strategies
        SET allocation_paise = $1,
            exposure_paise = $2,
            leverage = $3
        WHERE id = $4
      `, [input.allocationPaise, input.exposurePaise, input.leverage, strategy.id])

      // Journal the allocation change (what the timeline tracks) as a delta pay-in/pay-out so the
      // ledger balance stays = allocation. Only for timeline clients and only if it actually changed.
      if (hasEvents && input.allocationPaise !== evBalance) {
        const diff = input.allocationPaise - evBalance
        const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)   // IST date
        await client.query(`
          INSERT INTO capital_events (client_id, strategy_id, effective_date, type, amount_paise, ref)
          VALUES ($1, $2, $3, $4, $5, 'capital adjustment')
        `, [dbClient.id, strategy.strategy_id, today, diff > 0 ? 'PAY_IN' : 'PAY_OUT', Math.abs(diff)])
      }
      allocationUpdated = {
        strategy_code: strategy.code,
        allocation_cr: input.allocationCr,
        exposure_cr: input.exposureCr,
        leverage: input.leverage,
      }
    } else if (input.strategyCode) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'Active client strategy not found.' })
    } else if (input.strategyFieldsExplicit && strategyRows.rowCount > 1) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: 'strategy_code is required when a client has multiple active strategies.' })
    }

    await client.query('COMMIT')

    return {
      client: {
        code: dbClient.code,
        name: dbClient.name,
        category: dbClient.category,
        aum_cr: input.aumCr,
      },
      allocation: allocationUpdated,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    req.log.error(err)
    return reply.code(500).send({ error: 'Could not update client capital.' })
  } finally {
    client.release()
  }
}
