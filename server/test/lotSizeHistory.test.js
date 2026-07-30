import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LOT_SIZE_HISTORY,
  lotSizeFromHistory,
  parseLotSizeEntry,
} from '../src/data/lotSizeHistory.js'

test('default lot history preserves the existing NIFTY and MIDCAP schedules', () => {
  assert.equal(lotSizeFromHistory(DEFAULT_LOT_SIZE_HISTORY, 'NIFTY', '2024-10-31'), 25)
  assert.equal(lotSizeFromHistory(DEFAULT_LOT_SIZE_HISTORY, 'NIFTY', '2024-11-28'), 75)
  assert.equal(lotSizeFromHistory(DEFAULT_LOT_SIZE_HISTORY, 'NIFTY', '2025-12-30'), 65)
  assert.equal(lotSizeFromHistory(DEFAULT_LOT_SIZE_HISTORY, 'MIDCPNIFTY', '2025-05-29'), 140)
  assert.equal(lotSizeFromHistory(DEFAULT_LOT_SIZE_HISTORY, 'MIDCPNIFTY', '2025-10-28'), 120)
})

test('a newly effective row overrides later contract sizing', () => {
  const history = [
    ...DEFAULT_LOT_SIZE_HISTORY,
    { underlying: 'NIFTY', effective_date: '2026-08-01', lot_size: 55 },
  ]
  assert.equal(lotSizeFromHistory(history, 'NIFTY', '2026-07-30'), 65)
  assert.equal(lotSizeFromHistory(history, 'NIFTY', '2026-08-27'), 55)
})

test('lot-size input accepts supported indices and rejects unsafe values', () => {
  const parsed = parseLotSizeEntry({ underlying: 'nifty', effective_date: '2026-08-01', lot_size: 55 })
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.value, { underlying: 'NIFTY', effectiveDate: '2026-08-01', lotSize: 55 })
  assert.equal(parseLotSizeEntry({ underlying: 'BANKNIFTY', effective_date: '2026-08-01', lot_size: 55 }).ok, false)
  assert.equal(parseLotSizeEntry({ underlying: 'NIFTY', effective_date: 'not-a-date', lot_size: 55 }).ok, false)
  assert.equal(parseLotSizeEntry({ underlying: 'NIFTY', effective_date: '2026-08-01', lot_size: 0 }).ok, false)
  assert.equal(parseLotSizeEntry({ underlying: 'NIFTY', effective_date: '2026-08-01', lot_size: 12.5 }).ok, false)
})
