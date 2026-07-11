const CR_INR = 1e7

function finiteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sampleStd(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function sharpeFromReturns(returns) {
  if (returns.length < 2) return 0
  const std = sampleStd(returns)
  if (std === 0) return 0
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  return +((mean / std) * Math.sqrt(12)).toFixed(2)
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function signedPower(value, power) {
  return Math.sign(value) * Math.abs(value) ** power
}

function dateDiffDays(start, end) {
  if (!start || !end) return 0
  const a = new Date(start + 'T00:00:00Z')
  const b = new Date(end + 'T00:00:00Z')
  return Math.max(0, Math.round((b - a) / 86400000))
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const idx = (sortedValues.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedValues[lo]
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo)
}

export function monthlyReturns(monthly, capitalCr) {
  const capitalInr = finiteNumber(capitalCr) * CR_INR
  return (monthly || []).map(row => {
    const netInr = finiteNumber(row.net_inr)
    return capitalInr > 0 ? +(netInr / capitalInr * 100).toFixed(6) : finiteNumber(row.pct)
  })
}

export function buildEquityDrawdownSeries(monthly, _capitalCr) {
  let cumulativeInr = 0
  let peakEquity = 0
  return (monthly || []).map(row => {
    cumulativeInr += finiteNumber(row.net_inr)
    const equityInr = cumulativeInr
    if (equityInr > peakEquity) peakEquity = equityInr
    const drawdownPct = peakEquity > 0 ? +((equityInr / peakEquity - 1) * 100).toFixed(4) : 0
    return {
      month: row.month,
      equity_inr: Math.round(equityInr),
      cumulative_inr: Math.round(cumulativeInr),
      drawdown_pct: drawdownPct,
    }
  })
}

export function buildCapitalDrawdownSeries(monthly, capitalCr) {
  const startingCapitalInr = finiteNumber(capitalCr) * CR_INR
  let cumulativeInr = 0
  let peakEquity = startingCapitalInr
  return (monthly || []).map(row => {
    cumulativeInr += finiteNumber(row.net_inr)
    const equityInr = startingCapitalInr + cumulativeInr
    if (equityInr > peakEquity) peakEquity = equityInr
    const drawdownPct = peakEquity > 0 ? +((equityInr / peakEquity - 1) * 100).toFixed(4) : 0
    return {
      month: row.month,
      equity_inr: Math.round(equityInr),
      cumulative_inr: Math.round(cumulativeInr),
      drawdown_pct: drawdownPct,
    }
  })
}

export function maxDrawdownPct(monthly, capitalCr) {
  const series = buildEquityDrawdownSeries(monthly, capitalCr)
  if (!series.length) return 0
  return +Math.abs(Math.min(...series.map(row => row.drawdown_pct))).toFixed(2)
}

// Capital-based max drawdown: equity starts from capitalCr (not 0), so a single
// leg whose cumulative dips negative early doesn't blow up to a nonsense −100%+.
export function capitalMaxDrawdownPct(monthly, capitalCr) {
  const series = buildCapitalDrawdownSeries(monthly, capitalCr)
  if (!series.length) return 0
  return +Math.abs(Math.min(...series.map(row => row.drawdown_pct))).toFixed(2)
}

export function rollingSharpe(monthly, capitalCr, window = 12) {
  const returns = monthlyReturns(monthly, capitalCr)
  const rows = monthly || []
  if (window < 2 || returns.length < window) return []
  const out = []
  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1)
    out.push({
      month: rows[i].month,
      sharpe: sharpeFromReturns(slice),
    })
  }
  return out
}

function boxStats(label, values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const q1 = percentile(sorted, 0.25)
  const median = percentile(sorted, 0.5)
  const q3 = percentile(sorted, 0.75)
  const iqr = q3 - q1
  const lowFence = q1 - iqr * 1.5
  const highFence = q3 + iqr * 1.5
  const inliers = sorted.filter(value => value >= lowFence && value <= highFence)
  return {
    label,
    min: inliers[0] ?? sorted[0],
    q1,
    median,
    q3,
    max: inliers[inliers.length - 1] ?? sorted[sorted.length - 1],
    outliers: sorted.filter(value => value < lowFence || value > highFence),
    values: sorted,
  }
}

export function returnQuantiles(monthly, capitalCr) {
  const rows = monthly || []
  const monthlyValues = monthlyReturns(rows, capitalCr)
  const quarterMap = new Map()
  const yearMap = new Map()
  rows.forEach((row, idx) => {
    const month = String(row.month || '')
    const year = month.slice(0, 4)
    const monthNum = Number(month.slice(5, 7))
    if (!year || !monthNum) return
    const quarter = Math.floor((monthNum - 1) / 3) + 1
    const value = monthlyValues[idx] || 0
    const qKey = `${year}-Q${quarter}`
    quarterMap.set(qKey, (quarterMap.get(qKey) || 0) + value)
    yearMap.set(year, (yearMap.get(year) || 0) + value)
  })
  return [
    boxStats('Monthly', monthlyValues),
    boxStats('Quarterly', [...quarterMap.values()]),
    boxStats('Yearly', [...yearMap.values()]),
  ].filter(Boolean)
}

export function monthlyReturnHistogram(monthly, capitalCr, binSize = 2) {
  const returns = monthlyReturns(monthly, capitalCr)
  if (!returns.length || binSize <= 0) return []
  const min = Math.floor(Math.min(...returns) / binSize) * binSize
  const max = Math.ceil(Math.max(...returns) / binSize) * binSize
  const bins = []
  for (let from = min; from < max; from += binSize) {
    bins.push({ from, to: from + binSize, count: 0 })
  }
  if (!bins.length) bins.push({ from: min, to: min + binSize, count: 0 })
  returns.forEach(value => {
    const idx = Math.min(bins.length - 1, Math.max(0, Math.floor((value - min) / binSize)))
    bins[idx].count += 1
  })
  return bins.map(bin => ({
    ...bin,
    label: `${bin.from}% to ${bin.to}%`,
  }))
}

export function yearlyReturns(monthly, capitalCr) {
  const capitalInr = finiteNumber(capitalCr) * CR_INR
  const map = new Map()
  ;(monthly || []).forEach(row => {
    const year = String(row.month || '').slice(0, 4)
    if (!year) return
    if (!map.has(year)) map.set(year, { year, net_inr: 0, trades: 0, rows: [] })
    const target = map.get(year)
    target.net_inr += finiteNumber(row.net_inr)
    target.trades += finiteNumber(row.trades)
    target.rows.push(row)
  })
  let cumulativeInr = 0
  return [...map.values()].sort((a, b) => a.year.localeCompare(b.year)).map(row => {
    cumulativeInr += row.net_inr
    return {
      year: row.year,
      trades: row.trades,
      net_inr: Math.round(row.net_inr),
      net_cr: +(row.net_inr / CR_INR).toFixed(2),
      return_pct: capitalInr > 0 ? +(row.net_inr / capitalInr * 100).toFixed(2) : 0,
      cumulative_pct: capitalInr > 0 ? +(cumulativeInr / capitalInr * 100).toFixed(2) : 0,
      max_dd_pct: (() => {
        // Capital-based: start equity from capitalCr, not from 0
        const capInr = finiteNumber(capitalCr) * CR_INR
        let cum = 0, peak = capInr, maxDD = 0
        for (const r of row.rows) {
          cum += finiteNumber(r.net_inr)
          const eq = capInr + cum
          if (eq > peak) peak = eq
          const dd = peak > 0 ? (peak - eq) / peak : 0
          if (dd > maxDD) maxDD = dd
        }
        return +(maxDD * 100).toFixed(2)
      })(),
      sharpe: sharpeFromReturns(monthlyReturns(row.rows, capitalCr)),
    }
  })
}

export function worstDrawdowns(monthly, _capitalCr, limit = 5) {
  let cumulativeInr = 0
  let peakEquity = 0
  let peakMonth = monthly?.[0]?.month || ''
  let active = null
  const periods = []

  ;(monthly || []).forEach(row => {
    cumulativeInr += finiteNumber(row.net_inr)
    const equityInr = cumulativeInr

    if (equityInr >= peakEquity) {
      if (active) {
        active.recovered = row.month
        active.days = dateDiffDays(active.started, active.recovered)
        periods.push(active)
        active = null
      }
      peakEquity = equityInr
      peakMonth = row.month
      return
    }

    const drawdownPct = +((equityInr / peakEquity - 1) * 100).toFixed(4)
    if (!active) {
      active = {
        started: peakMonth || row.month,
        recovered: null,
        trough: row.month,
        drawdown_pct: drawdownPct,
        days: 0,
      }
    }
    if (drawdownPct < active.drawdown_pct) {
      active.trough = row.month
      active.drawdown_pct = drawdownPct
    }
  })

  if (active) {
    const lastMonth = monthly?.[monthly.length - 1]?.month || active.trough
    active.days = dateDiffDays(active.started, lastMonth)
    periods.push(active)
  }

  return periods
    .sort((a, b) => a.drawdown_pct - b.drawdown_pct)
    .slice(0, limit)
    .map(row => ({
      ...row,
      drawdown_pct: +row.drawdown_pct.toFixed(2),
    }))
}

export function extendedRiskMetrics(monthly, capitalCr) {
  const returns = monthlyReturns(monthly, capitalCr)
  const rows = monthly || []
  const capitalInr = finiteNumber(capitalCr) * CR_INR
  const totalNet = rows.reduce((sum, row) => sum + finiteNumber(row.net_inr), 0)
  const totalReturnPct = capitalInr > 0 ? totalNet / capitalInr * 100 : 0
  const years = rows.length > 0 ? rows.length / 12 : 0
  const cagrPct = years > 0 && capitalInr > 0
    ? (Math.pow(Math.max(0.000001, 1 + totalNet / capitalInr), 1 / years) - 1) * 100
    : 0
  const maxDD = maxDrawdownPct(rows, capitalCr)
  const positive = rows.map(row => finiteNumber(row.net_inr)).filter(value => value > 0)
  const negative = rows.map(row => finiteNumber(row.net_inr)).filter(value => value < 0)
  const positiveSum = positive.reduce((sum, value) => sum + value, 0)
  const negativeAbsSum = Math.abs(negative.reduce((sum, value) => sum + value, 0))
  const downside = returns.filter(value => value < 0)
  const downsideDeviation = downside.length
    ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length)
    : 0
  const meanReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0
  const returnWins = returns.filter(value => value > 0)
  const returnLosses = returns.filter(value => value < 0)
  const avgWin = positive.length ? positiveSum / positive.length : 0
  const avgLoss = negative.length ? negativeAbsSum / negative.length : 0
  const avgReturnWin = mean(returnWins)
  const avgReturnLoss = mean(returnLosses)
  const profitFactor = negativeAbsSum === 0 ? 0 : positiveSum / negativeAbsSum
  const payoffRatio = avgLoss === 0 ? 0 : avgWin / avgLoss
  const nonZeroReturns = returns.filter(value => value !== 0)
  const winRate = nonZeroReturns.length ? returnWins.length / nonZeroReturns.length : 0
  const lossRate = nonZeroReturns.length ? returnLosses.length / nonZeroReturns.length : 0
  const sortedReturns = [...returns].sort((a, b) => a - b)
  const leftTail = Math.abs(percentile(sortedReturns, 0.05))
  const rightTail = Math.abs(percentile(sortedReturns, 0.95))
  const tailRatio = leftTail === 0 ? 0 : rightTail / leftTail
  const returnStd = sampleStd(returns)
  const skew = returns.length > 2 && returnStd !== 0
    ? mean(returns.map(value => ((value - meanReturn) / returnStd) ** 3))
    : 0
  const kurtosis = returns.length > 3 && returnStd !== 0
    ? mean(returns.map(value => ((value - meanReturn) / returnStd) ** 4)) - 3
    : 0
  const kelly = payoffRatio === 0 ? 0 : ((payoffRatio * winRate) - lossRate) / payoffRatio
  const outlierWin = avgReturnWin === 0 ? 0 : percentile(sortedReturns, 0.99) / avgReturnWin
  const outlierLoss = avgReturnLoss === 0 ? 0 : signedPower(percentile(sortedReturns, 0.01) / avgReturnLoss, 1)

  return {
    sortino: downsideDeviation === 0 ? 0 : +((meanReturn / downsideDeviation) * Math.sqrt(12)).toFixed(2),
    calmar: maxDD === 0 ? 0 : +(cagrPct / maxDD).toFixed(2),
    annual_vol_pct: +(sampleStd(returns) * Math.sqrt(12)).toFixed(2),
    profit_factor: +profitFactor.toFixed(2),
    payoff_ratio: +payoffRatio.toFixed(2),
    recovery_factor: maxDD === 0 ? 0 : +(totalReturnPct / maxDD).toFixed(2),
    common_sense_ratio: +(profitFactor * tailRatio).toFixed(2),
    cpc_index: +(profitFactor * winRate * payoffRatio).toFixed(2),
    tail_ratio: +tailRatio.toFixed(2),
    win_loss_ratio: +payoffRatio.toFixed(2),
    gain_pain_ratio: +profitFactor.toFixed(2),
    kelly_criterion_pct: +(kelly * 100).toFixed(2),
    avg_return_pct: +meanReturn.toFixed(2),
    avg_win_pct: +avgReturnWin.toFixed(2),
    avg_loss_pct: +avgReturnLoss.toFixed(2),
    skew: +skew.toFixed(2),
    kurtosis: +kurtosis.toFixed(2),
    outlier_win_ratio: +outlierWin.toFixed(2),
    outlier_loss_ratio: +outlierLoss.toFixed(2),
    cagr_pct: +cagrPct.toFixed(2),
    max_dd_pct: maxDD,
  }
}
