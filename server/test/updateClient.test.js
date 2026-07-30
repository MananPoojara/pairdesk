import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClientUpdate } from '../src/routes/updateClient.js'

const valid = {
  code: 'NEW_CODE',
  name: 'Updated Client',
  category: 'HNI',
  aum_cr: 25,
  allocation_cr: 20,
  exposure_cr: 30,
  cash_cr: 12,
  pledge_cr: 8,
  brokerage_pct: 0.02,
  tax_pct: 18,
  exec_type: 'F2O',
  joined_at: '2026-07-01',
  strategy_code: 'MIDCAP_NIFTY_PAIR',
}

test('full client edit parser normalizes and derives persisted values', () => {
  const parsed = parseClientUpdate({ code: 'old_code' }, valid)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.currentCode, 'OLD_CODE')
  assert.equal(parsed.value.code, 'NEW_CODE')
  assert.equal(parsed.value.aumPaise, 25_000_000_000)
  assert.equal(parsed.value.allocationPaise, 20_000_000_000)
  assert.equal(parsed.value.exposurePaise, 30_000_000_000)
  assert.equal(parsed.value.leverage, 1.5)
  assert.equal(parsed.value.cashPaise, 12_000_000_000)
  assert.equal(parsed.value.pledgePaise, 8_000_000_000)
})

test('full client edit parser rejects invalid splits, identifiers and dates', () => {
  assert.equal(parseClientUpdate({ code: '../bad' }, valid).ok, false)
  assert.equal(parseClientUpdate({ code: 'OLD' }, { ...valid, code: '../bad' }).ok, false)
  assert.equal(parseClientUpdate({ code: 'OLD' }, { ...valid, cash_cr: 19, pledge_cr: 8 }).ok, false)
  assert.equal(parseClientUpdate({ code: 'OLD' }, { ...valid, joined_at: 'tomorrow' }).ok, false)
  assert.equal(parseClientUpdate({ code: 'OLD' }, { ...valid, exec_type: 'ADMIN' }).ok, false)
})
