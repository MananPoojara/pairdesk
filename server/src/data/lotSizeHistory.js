import { query } from '../db/pg.js'

export const DEFAULT_LOT_SIZE_HISTORY = Object.freeze([
  { underlying: 'NIFTY', effective_date: '1900-01-01', lot_size: 25 },
  { underlying: 'NIFTY', effective_date: '2024-11-20', lot_size: 75 },
  { underlying: 'NIFTY', effective_date: '2025-12-30', lot_size: 65 },
  { underlying: 'MIDCPNIFTY', effective_date: '1900-01-01', lot_size: 50 },
  { underlying: 'MIDCPNIFTY', effective_date: '2024-11-20', lot_size: 120 },
  { underlying: 'MIDCPNIFTY', effective_date: '2025-04-25', lot_size: 140 },
  { underlying: 'MIDCPNIFTY', effective_date: '2025-10-28', lot_size: 120 },
])

const SUPPORTED = new Set(['NIFTY', 'MIDCPNIFTY'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function validIsoDate(value) {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function parseLotSizeEntry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Request body must be an object.' }
  }
  const underlying = String(body.underlying || '').trim().toUpperCase()
  const effectiveDate = String(body.effective_date || '').trim()
  const lotSize = Number(body.lot_size)
  if (!SUPPORTED.has(underlying)) {
    return { ok: false, status: 400, error: 'underlying must be NIFTY or MIDCPNIFTY.' }
  }
  if (!validIsoDate(effectiveDate)) {
    return { ok: false, status: 400, error: 'effective_date must be a valid YYYY-MM-DD date.' }
  }
  if (!Number.isInteger(lotSize) || lotSize < 1 || lotSize > 10_000) {
    return { ok: false, status: 400, error: 'lot_size must be a whole number between 1 and 10000.' }
  }
  return { ok: true, value: { underlying, effectiveDate, lotSize } }
}

export function lotSizeFromHistory(history, underlying, contractDate) {
  const symbol = String(underlying || '').toUpperCase()
  const date = String(contractDate || '').slice(0, 10)
  const rows = (history || [])
    .filter(row => row.underlying === symbol && String(row.effective_date).slice(0, 10) <= date)
    .sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)))
  if (!rows.length) {
    const fallback = DEFAULT_LOT_SIZE_HISTORY
      .filter(row => row.underlying === symbol && row.effective_date <= date)
    return fallback[fallback.length - 1]?.lot_size || 1
  }
  return Number(rows[rows.length - 1].lot_size)
}

export async function readLotSizeHistory() {
  try {
    const { rows } = await query(`
      SELECT underlying, to_char(effective_date, 'YYYY-MM-DD') AS effective_date, lot_size
      FROM lot_size_history
      ORDER BY underlying, effective_date
    `)
    return rows.length
      ? rows.map(row => ({ ...row, lot_size: Number(row.lot_size) }))
      : DEFAULT_LOT_SIZE_HISTORY
  } catch (error) {
    // Safe rolling-deploy fallback: quantity pages keep their exact historical behavior until
    // the accompanying schema migration creates the table.
    if (error?.code === '42P01') return DEFAULT_LOT_SIZE_HISTORY
    throw error
  }
}
