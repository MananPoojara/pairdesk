import { maxDrawdownPct } from './riskAnalytics.js'

export const DASHBOARD_RANGE_MONTHS = { '1M': 1, '3M': 3, '1Y': 12, All: 9999 }

export function monthKey(date) {
  return String(date || '').slice(0, 7)
}

export function firstMonthlyDate(monthly) {
  return monthly?.[0]?.month || ''
}

export function lastMonthlyDate(monthly, fallbackDate) {
  return fallbackDate || monthly?.[monthly.length - 1]?.month || ''
}

export function shiftDateMonths(date, monthsBack) {
  if (!date) return ''
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() - monthsBack)
  return d.toISOString().slice(0, 10)
}

export function getPresetDatesFromBounds(minDate, maxDate, range) {
  if (!maxDate) return { start: minDate || '', end: '' }
  if (range === '1M') return { start: shiftDateMonths(maxDate, 1), end: maxDate }
  if (range === '3M') return { start: shiftDateMonths(maxDate, 3), end: maxDate }
  if (range === '1Y') return { start: shiftDateMonths(maxDate, 12), end: maxDate }
  return { start: minDate || maxDate, end: maxDate }
}

function sharpe(monthlyNets, aumInr) {
  if (monthlyNets.length < 2 || aumInr <= 0) return 0
  const pcts = monthlyNets.map(n => n / aumInr * 100)
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length
  const std = Math.sqrt(pcts.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / (pcts.length - 1))
  return std === 0 ? 0 : +((mean / std * Math.sqrt(12)).toFixed(2))
}

export function selectDashboardRange(monthly, range) {
  const months = DASHBOARD_RANGE_MONTHS[range] || DASHBOARD_RANGE_MONTHS.All
  return (monthly || []).slice(-months)
}

export function selectDashboardDateRange(monthly, startDate, endDate) {
  const startMonth = monthKey(startDate)
  const endMonth = monthKey(endDate)
  return (monthly || []).filter(row => {
    const rowMonth = monthKey(row.month)
    if (startMonth && rowMonth < startMonth) return false
    if (endMonth && rowMonth > endMonth) return false
    return true
  })
}

export function getDashboardPresetDates(monthly, range, fallbackEndDate) {
  const selected = selectDashboardRange(monthly, range)
  return {
    start: firstMonthlyDate(selected),
    end: lastMonthlyDate(monthly, fallbackEndDate),
  }
}

export function buildDashboardRangeStats(monthly, aumCr) {
  const rows = monthly || []
  const aumInr = Number(aumCr) * 1e7
  const hasCapital = Number.isFinite(aumInr) && aumInr > 0
  let cumulative = 0
  const resetMonthly = rows.map(row => ({
    ...row,
    cumulative_inr: (cumulative += Number(row.net_inr) || 0),
  }))
  const netByMonth = resetMonthly.map(row => row.net_inr)
  const totalNet = resetMonthly.at(-1)?.cumulative_inr || 0
  const bestMonth = netByMonth.length ? Math.max(...netByMonth) : 0
  const worstMonth = netByMonth.length ? Math.min(...netByMonth) : 0
  const wins = netByMonth.filter(n => n > 0).length

  return {
    monthly: resetMonthly,
    total_net_inr: Math.round(totalNet),
    realised_inr: Math.round(totalNet),
    return_pct: hasCapital ? +(totalNet / aumInr * 100).toFixed(2) : 0,
    best_month_pct: hasCapital ? +(bestMonth / aumInr * 100).toFixed(2) : 0,
    worst_month_pct: hasCapital ? +(worstMonth / aumInr * 100).toFixed(2) : 0,
    max_dd_pct: maxDrawdownPct(resetMonthly, aumCr),
    sharpe: sharpe(netByMonth, aumInr),
    win_rate: resetMonthly.length ? +(wins / resetMonthly.length * 100).toFixed(1) : 0,
  }
}
