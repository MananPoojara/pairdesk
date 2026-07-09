import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEquityDrawdownSeries,
  extendedRiskMetrics,
  maxDrawdownPct,
  monthlyReturnHistogram,
  rollingSharpe,
  worstDrawdowns,
  yearlyReturns,
} from '../src/lib/riskAnalytics.js'

const monthly = [
  { month: '2026-01-01', net_inr: 100, gross_inr: 120, trades: 2 },
  { month: '2026-02-01', net_inr: -50, gross_inr: -40, trades: 2 },
  { month: '2026-03-01', net_inr: -100, gross_inr: -90, trades: 2 },
  { month: '2026-04-01', net_inr: 200, gross_inr: 220, trades: 2 },
  { month: '2026-05-01', net_inr: -20, gross_inr: -10, trades: 2 },
]

test('buildEquityDrawdownSeries computes drawdown from strategy cumulative equity', () => {
  const series = buildEquityDrawdownSeries(monthly, 0.0001)

  assert.equal(series[0].drawdown_pct, 0)
  assert.equal(series[1].drawdown_pct, -50)
  assert.equal(series[2].drawdown_pct, -150)
  assert.equal(series[3].drawdown_pct, 0)
  assert.equal(maxDrawdownPct(monthly, 0.0001), 150)
})

test('worstDrawdowns identifies closed and active drawdown periods', () => {
  const rows = worstDrawdowns(monthly, 0.0001, 2)

  assert.deepEqual(rows.map(row => ({
    started: row.started,
    recovered: row.recovered,
    trough: row.trough,
    drawdown_pct: row.drawdown_pct,
  })), [
    { started: '2026-01-01', recovered: '2026-04-01', trough: '2026-03-01', drawdown_pct: -150 },
    { started: '2026-04-01', recovered: null, trough: '2026-05-01', drawdown_pct: -13.33 },
  ])
})

test('rollingSharpe returns annualized monthly-window sharpe values', () => {
  const rows = rollingSharpe(monthly, 0.0001, 3)

  assert.equal(rows.length, 3)
  assert.equal(rows[0].month, '2026-03-01')
  assert.equal(rows[0].sharpe, -0.55)
})

test('monthlyReturnHistogram and yearlyReturns aggregate from actual monthly data', () => {
  const histogram = monthlyReturnHistogram(monthly, 0.0001, 10)
  const yearly = yearlyReturns(monthly, 0.0001)

  assert.deepEqual(histogram.map(bin => [bin.from, bin.to, bin.count]), [
    [-10, 0, 3],
    [0, 10, 0],
    [10, 20, 2],
  ])
  assert.deepEqual(yearly, [{
    year: '2026',
    net_inr: 130,
    trades: 10,
    net_cr: 0,
    return_pct: 13,
    cumulative_pct: 13,
    max_dd_pct: 150,
    sharpe: 0.74,
  }])
})

test('extendedRiskMetrics computes matrix values from monthly returns', () => {
  const metrics = extendedRiskMetrics(monthly, 0.0001)

  assert.equal(metrics.sortino, 1.37)
  assert.equal(metrics.annual_vol_pct, 42.26)
  assert.equal(metrics.profit_factor, 1.76)
  assert.equal(metrics.payoff_ratio, 2.65)
  assert.equal(metrics.recovery_factor, 0.09)
  assert.equal(metrics.max_dd_pct, 150)
})
