import { query } from '../db/pg.js'

// Futures charge rates — exchange txn charge, SEBI turnover fee, stamp duty, GST (on brokerage +
// exch + SEBI), STT. Fractions of notional (e.g. 0.0000173 = ₹1.73/lakh), GST is a fraction of the
// exch+SEBI amount. Persisted in `platform_settings` (key/value) so the Admin page can edit them
// live; DEFAULTS match the historical hardcoded rates (pre-2026-03-01 STT change already baked into
// the ingested trade history, so only the OPEN cycle's live mark-to-market uses these at runtime).
export const DEFAULT_RATES = { exch: 0.0000173, sebi: 0.000001, stamp: 0.0002, gst: 0.18, stt: 0.0005 }

const KEYS = { exch: 'charge_exch_rate', sebi: 'charge_sebi_rate', stamp: 'charge_stamp_rate', gst: 'charge_gst_rate', stt: 'charge_stt_rate' }

let rates = { ...DEFAULT_RATES }

export function getRates() {
  return rates
}

export async function loadRates() {
  const { rows } = await query(`SELECT key, value FROM platform_settings WHERE key = ANY($1)`, [Object.values(KEYS)])
  const byKey = Object.fromEntries(rows.map(r => [r.key, Number(r.value)]))
  rates = Object.fromEntries(Object.entries(KEYS).map(([k, dbKey]) => [k, Number.isFinite(byKey[dbKey]) ? byKey[dbKey] : DEFAULT_RATES[k]]))
  return rates
}

export async function saveRates(next) {
  const merged = { ...rates }
  for (const k of Object.keys(KEYS)) {
    if (next[k] == null) continue
    const n = Number(next[k])
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`Invalid rate for ${k}`)
    merged[k] = n
  }
  for (const k of Object.keys(KEYS)) {
    await query(`
      INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [KEYS[k], String(merged[k])])
  }
  rates = merged
  return rates
}
