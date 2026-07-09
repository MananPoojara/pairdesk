import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCapitalUpdate } from '../src/routes/clientCapital.js'

test('parseCapitalUpdate accepts a valid client capital update', () => {
  const parsed = parseCapitalUpdate(
    { code: 'test' },
    { aum_cr: 42.5, allocation_cr: 30, exposure_cr: 45, strategy_code: 'midcap_nifty_pair' },
  )

  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.code, 'TEST')
  assert.equal(parsed.value.strategyCode, 'MIDCAP_NIFTY_PAIR')
  assert.equal(parsed.value.aumPaise, 42_500_000_000)
  assert.equal(parsed.value.allocationPaise, 30_000_000_000)
  assert.equal(parsed.value.exposurePaise, 45_000_000_000)
  assert.equal(parsed.value.leverage, 1.5)
  assert.equal(parsed.value.strategyFieldsExplicit, true)
})

test('parseCapitalUpdate defaults allocation and exposure to total capital', () => {
  const parsed = parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 12 })

  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.aumPaise, 12_000_000_000)
  assert.equal(parsed.value.allocationPaise, 12_000_000_000)
  assert.equal(parsed.value.exposurePaise, 12_000_000_000)
  assert.equal(parsed.value.leverage, 1)
  assert.equal(parsed.value.strategyFieldsExplicit, false)
})

test('parseCapitalUpdate derives exposure from leverage', () => {
  const parsed = parseCapitalUpdate(
    { code: 'TEST' },
    { aum_cr: 20, allocation_cr: 8, leverage: 2.25 },
  )

  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.allocationPaise, 8_000_000_000)
  assert.equal(parsed.value.exposurePaise, 18_000_000_000)
  assert.equal(parsed.value.leverage, 2.25)
})

test('parseCapitalUpdate rejects invalid capital values', () => {
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 0 }).ok, false)
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: -1 }).ok, false)
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 100_001 }).ok, false)
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 'abc' }).ok, false)
})

test('parseCapitalUpdate rejects allocation greater than total capital', () => {
  const parsed = parseCapitalUpdate(
    { code: 'TEST' },
    { aum_cr: 10, allocation_cr: 15 },
  )

  assert.equal(parsed.ok, false)
  assert.equal(parsed.status, 400)
})

test('parseCapitalUpdate rejects invalid exposure and leverage combinations', () => {
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 10, allocation_cr: 0, exposure_cr: 1 }).ok, false)
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 10, allocation_cr: 1, exposure_cr: 11 }).ok, false)
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 10, allocation_cr: 1, leverage: 10.1 }).ok, false)
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 10, allocation_cr: 1, exposure_cr: -1 }).ok, false)
})

test('parseCapitalUpdate validates client and strategy identifiers', () => {
  assert.equal(parseCapitalUpdate({ code: '../bad' }, { aum_cr: 10 }).ok, false)
  assert.equal(parseCapitalUpdate({ code: 'TEST' }, { aum_cr: 10, strategy_code: '../bad' }).ok, false)
})
