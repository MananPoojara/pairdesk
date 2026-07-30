import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatMonthlyReturn,
  marginFromExposureCr,
  truncateOneDecimal,
} from '../src/lib/dashboardPresentation.js'

test('margin is 12% of the selected exposure for every instrument view', () => {
  assert.equal(marginFromExposureCr(100), 12)
  assert.equal(marginFromExposureCr(42.5), 5.1)
  assert.equal(marginFromExposureCr(0), 0)
})

test('monthly returns truncate to one decimal instead of rounding', () => {
  assert.equal(truncateOneDecimal(0.01), 0)
  assert.equal(truncateOneDecimal(1.01), 1)
  assert.equal(truncateOneDecimal(2.25), 2.2)
  assert.equal(truncateOneDecimal(-2.29), -2.2)
  assert.equal(formatMonthlyReturn(2.25), '2.2%')
  assert.equal(formatMonthlyReturn(-0.01), '0.0%')
})
