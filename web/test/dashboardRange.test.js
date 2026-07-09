import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDashboardRangeStats,
  getDashboardPresetDates,
  getPresetDatesFromBounds,
  selectDashboardDateRange,
  selectDashboardRange,
} from '../src/lib/dashboardRange.js'

const monthly = [
  { month: '2026-01-01', net_inr: 100, cumulative_inr: 100 },
  { month: '2026-02-01', net_inr: -40, cumulative_inr: 60 },
  { month: '2026-03-01', net_inr: 20, cumulative_inr: 80 },
  { month: '2026-04-01', net_inr: 10, cumulative_inr: 90 },
]

test('selectDashboardRange slices from the latest month', () => {
  assert.deepEqual(selectDashboardRange(monthly, '1M').map(m => m.month), ['2026-04-01'])
  assert.deepEqual(selectDashboardRange(monthly, '3M').map(m => m.month), ['2026-02-01', '2026-03-01', '2026-04-01'])
  assert.deepEqual(selectDashboardRange(monthly, 'All').map(m => m.month), monthly.map(m => m.month))
})

test('buildDashboardRangeStats recomputes totals and cumulative path for the selected window', () => {
  const selected = selectDashboardRange(monthly, '3M')
  const stats = buildDashboardRangeStats(selected, 0.0001)

  assert.equal(stats.total_net_inr, -10)
  assert.equal(stats.realised_inr, -10)
  assert.equal(stats.monthly[0].cumulative_inr, -40)
  assert.equal(stats.monthly[1].cumulative_inr, -20)
  assert.equal(stats.monthly[2].cumulative_inr, -10)
  assert.equal(stats.return_pct, -1)
  assert.equal(stats.best_month_pct, 2)
  assert.equal(stats.worst_month_pct, -4)
  assert.equal(stats.win_rate, 66.7)
})

test('selectDashboardDateRange filters monthly rows using start and end months', () => {
  const selected = selectDashboardDateRange(monthly, '2026-02-15', '2026-03-10')

  assert.deepEqual(selected.map(m => m.month), ['2026-02-01', '2026-03-01'])
})

test('getDashboardPresetDates exposes dates for the visible top-bar controls', () => {
  assert.deepEqual(getDashboardPresetDates(monthly, '1M', '2026-04-25'), {
    start: '2026-04-01',
    end: '2026-04-25',
  })
})

test('getPresetDatesFromBounds builds exact daily ranges from the latest date', () => {
  assert.deepEqual(getPresetDatesFromBounds('2024-09-26', '2026-05-26', '3M'), {
    start: '2026-02-26',
    end: '2026-05-26',
  })
  assert.deepEqual(getPresetDatesFromBounds('2024-09-26', '2026-05-26', 'All'), {
    start: '2024-09-26',
    end: '2026-05-26',
  })
})
