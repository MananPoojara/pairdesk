import { query } from '../db/pg.js'
import {
  DEFAULT_LOT_SIZE_HISTORY,
  parseLotSizeEntry,
  readLotSizeHistory,
} from '../data/lotSizeHistory.js'

export async function lotSizesHandler() {
  const rows = await readLotSizeHistory()
  return { rows: rows.length ? rows : DEFAULT_LOT_SIZE_HISTORY }
}

export async function createLotSizeHandler(req, reply) {
  const parsed = parseLotSizeEntry(req.body)
  if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error })
  const { underlying, effectiveDate, lotSize } = parsed.value
  try {
    const { rows: [row] } = await query(`
      INSERT INTO lot_size_history (underlying, effective_date, lot_size)
      VALUES ($1, $2, $3)
      RETURNING underlying, to_char(effective_date, 'YYYY-MM-DD') AS effective_date, lot_size
    `, [underlying, effectiveDate, lotSize])
    return reply.code(201).send({ row: { ...row, lot_size: Number(row.lot_size) } })
  } catch (error) {
    if (error?.code === '23505') {
      return reply.code(409).send({ error: 'A lot size already exists for that index and date.' })
    }
    req.log.error(error)
    return reply.code(500).send({ error: 'Could not save the lot-size change.' })
  }
}
