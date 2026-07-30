import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import DateRangeControl from '../components/DateRangeControl'
import MarketTickers from '../components/MarketTickers'
import LegPerformanceModal from '../components/LegPerformanceModal'
import { DashboardEntryContext } from '../lib/dashboardEntry'
import { fmtInr, fmtCr, fmtDate, fmtNum } from '../lib/format'
import { buildCurvePath, hmColor, hmText } from '../lib/curve'
import {
  buildDashboardRangeStats,
  firstMonthlyDate,
  getDashboardPresetDates,
  lastMonthlyDate,
  legMonthly,
  selectDashboardDateRange,
  selectDashboardRange,
} from '../lib/dashboardRange'
import {
  adaptiveTicks,
  buildBacktestRows,
  buildDateCurvePath,
  compoundYearlyPct,
  dateLinePoints,
  dateMs,
  equityDomain,
  equityValueDomain,
  timelineTicks,
} from '../lib/equityBacktest'
import { capitalMaxDrawdownPct, yearlyReturns } from '../lib/riskAnalytics'
import { useEscClose } from '../lib/useEscClose'
import { VARIANTS } from '../lib/variantData'
import { INDEX_YEARLY } from '../lib/indexYearly'
import { formatMonthlyReturn, marginFromExposureCr } from '../lib/dashboardPresentation'
import { FloatingTooltip } from '../components/ViewportTooltip'

const CATCOLOR = { Institution: '#0369A1', HNI: '#38BDF8', Retail: '#F97316' }
const CATCLS = { Institution: 'inst', HNI: 'hni', Retail: 'retail' }
const IDX = ['All Indices', 'NIFTY 50', 'NIFTY MIDCAP SELECT', 'Combined (pair)']
const EQ_W = 700
const EQ_H = 155
const EQ_PAD = 8

// Dashboard shows no leading "+" on positive figures (per design) — strip it; keep "−" for negatives.
const fInr = (n) => fmtInr(n).replace(/^\+/, '')
const fCrb = (cr) => fmtCr(cr).replace('₹', '')   // ₹-less Cr (Margin + Long-Short Exposure cards)

// Capital-weighted month-aligned combine of two base-30 Cr monthly series (both additive), for the
// "both instruments" view: combined[m] = a[m]×wa + b[m]×wb. Recomputes cumulative + %s (base 30 Cr).
function combineMonthly(a, b, wa, wb, baseCr = 30) {
  const map = new Map()
  const add = (arr, w) => { for (const m of (arr || [])) {
    const r = map.get(m.month) || { month: m.month, net_inr: 0, gross_inr: 0, charges_inr: 0, midcap_net_inr: 0, nifty_net_inr: 0, trades: 0 }
    r.net_inr += (m.net_inr || 0) * w
    r.gross_inr += (m.gross_inr || 0) * w
    r.charges_inr += (m.charges_inr || 0) * w
    r.midcap_net_inr += (m.midcap_net_inr || 0) * w
    r.nifty_net_inr += (m.nifty_net_inr || 0) * w
    r.trades += (m.trades || 0)                      // trade counts add, not weighted
    map.set(m.month, r)
  } }
  add(a, wa); add(b, wb)
  const rows = [...map.values()].sort((x, y) => x.month < y.month ? -1 : 1)
  const base = baseCr * 1e7
  let cum = 0
  for (const r of rows) {
    cum += r.net_inr; r.cumulative_inr = cum
    r.pct = +(r.net_inr / base * 100).toFixed(3)
    r.midcap_pct = +(r.midcap_net_inr / base * 100).toFixed(3)
    r.nifty_pct = +(r.nifty_net_inr / base * 100).toFixed(3)
  }
  return rows
}

export default function Dashboard() {
  const { enteredFromLogin, signalDashboardReady } = useContext(DashboardEntryContext)
  const { data: d, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet('/api/dashboard'),
    refetchInterval: () => 62000 - (Date.now() % 60000),  // align to ~:02 each minute (after the backend's :00 close-fetch)
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
  // Real F2O option book (DB-derived); falls back to the hardcoded showcase data if the API is down.
  const { data: optData } = useQuery({ queryKey: ['option-trades'], queryFn: () => apiGet('/api/option-trades'), staleTime: Infinity })
  const OPT = optData?.summary ? optData : VARIANTS.options

  const [mode, setMode] = useState('overall')   // overall | today
  const [posInstr, setPosInstr] = useState('fut') // fut | opt (Open Positions instrument)
  const [range, setRange] = useState('All')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [idx, setIdx] = useState('All Indices')
  const [idxOpen, setIdxOpen] = useState(false)
  const [lev, setLev] = useState(null)           // {exposure_cr, leverage} override
  const [editing, setEditing] = useState(false)
  const [breakdown, setBreakdown] = useState(false)
  const [netModal, setNetModal] = useState(false) // expanded Net PnL modal (hero curve)
  const [monthModal, setMonthModal] = useState(null) // heatmap cell → leg-performance descriptor {months,plabel,month,quarter}
  const [pieHover, setPieHover] = useState(null)   // client-mix donut hovered segment
  const [equityTip, setEquityTip] = useState(null)
  const [showBacktest, setShowBacktest] = useState(true)
  const [dIndexChip, setDIndexChip] = useState('combined')  // combined | nifty | midcap | banknifty
  // Instrument checkboxes — Fut (F2F) and Options (F2O) toggle independently. Both on (default) =
  // the combined full book (pre-partition view). At least one must stay checked.
  const [instr, setInstr] = useState({ fut: true, opt: true })
  const futOn = instr.fut, optOn = instr.opt
  const toggleInstr = (key) => setInstr(prev => {
    const next = { ...prev, [key]: !prev[key] }
    return (next.fut || next.opt) ? next : prev   // never allow both off
  })
  const [heatMode, setHeatMode] = useState('month')          // month | quarter (Monthly Returns view)

  useEffect(() => {
    if (!enteredFromLogin || !d) return undefined
    const frame = window.requestAnimationFrame(signalDashboardReady)
    return () => window.cancelAnimationFrame(frame)
  }, [d, enteredFromLogin, signalDashboardReady])

  if (isError) return <div className="shell"><div className="crumb">⚠ Could not reach API — is the server running on :3002? ({String(error?.message)})</div></div>
  if (!d) return <div className="shell"><div className="crumb">Loading…</div></div>

  const book = { ...d.book, ...(lev || {}) }
  // The backtest/book is calibrated at ₹30 Cr (base_aum_cr). The actual deployed AUM is the sum
  // of active clients (book.aum_cr). We keep every % on the 30 Cr base (scale-invariant) but
  // SCALE the displayed ₹ to the real AUM, so the dashboard reflects the capital actually
  // deployed instead of looking hardcoded at ₹30 Cr. dispScale = AUM / 30.
  const dispBaseCr = d.book.base_aum_cr ?? 30
  const dispAumCr = (book.aum_cr && book.aum_cr > 0) ? book.aum_cr : dispBaseCr   // fall back to base if no AUM
  const aumBaseInr = dispAumCr * 1e7   // denominator for the Net PnL modal's % (return-on-AUM) view
  const dispScale = dispBaseCr > 0 ? dispAumCr / dispBaseCr : 1
  const scaleInr = v => Math.round((v || 0) * dispScale)
  // Performance attribution by execution style (Model A): Fut→F2F capital, Options→F2O, both→combined.
  // The perf cards (Net PnL, Return on AUM, Equity/Yearly/Heatmap) scale to the SELECTED styles'
  // capital; margin / today / exposure keep the full live book (dispScale/dispAumCr above).
  const capByExec = ct => (d.clients || []).filter(c => (c.exec_type || 'F2F') === ct).reduce((s, c) => s + c.aum_cr, 0)
  const f2fCr = capByExec('F2F'), f2oCr = capByExec('F2O')
  const perfCapCr = ((futOn ? f2fCr : 0) + (optOn ? f2oCr : 0)) || dispBaseCr
  const perfScale = dispBaseCr > 0 ? perfCapCr / dispBaseCr : 1
  const perfScaleInr = v => Math.round((v || 0) * perfScale)
  const pos = d.positions || []
  const niftyPos = pos.find(p => p.underlying === 'NIFTY') || null
  const midPos = pos.find(p => p.underlying === 'MIDCPNIFTY') || null
  const totalUnrealRaw = (niftyPos?.unrealised_inr || 0) + (midPos?.unrealised_inr || 0)
  const totalUnreal = scaleInr(totalUnrealRaw)      // open-position mark-to-market, scaled to AUM
  const spreadPct = totalUnrealRaw / dispBaseCr / 1e7 * 100

  // Variant toggle: Options / BankNifty swap the PERFORMANCE data (curve, heatmap, yearly,
  // hero PnL) to hardcoded verified showcase data. The live book (positions, clients, margin)
  // stays as-is. Default (Combined + Fut) → vActive null → identical to before.
  // Options performance variant applies ONLY when Options is the sole selection; with both checked
  // the perf cards show the live combined book (the pre-partition view the user expects).
  const vActive = (optOn && !futOn) ? OPT
    : (!optOn && dIndexChip === 'banknifty') ? VARIANTS.banknifty
    : null
  // Fut + Nifty/Midcap chip → show that leg of the pair only (Options selection disables index chips).
  const legFilter = (!optOn && futOn && (dIndexChip === 'nifty' || dIndexChip === 'midcap')) ? dIndexChip : null
  const legLabel = legFilter === 'nifty' ? 'NIFTY 50 leg' : legFilter === 'midcap' ? 'NIFTY Midcap Select leg' : null
  // Both instruments → capital-weighted combine of futures (F2F) + options variant (F2O); single
  // selection → that style's own series (vActive/legFilter already gate on futOn/optOn above).
  const srcMonthly = (futOn && optOn)
    ? combineMonthly(d.monthly, OPT.monthly, f2fCr / perfCapCr, f2oCr / perfCapCr, dispBaseCr)
    : vActive ? vActive.monthly
    : legFilter ? legMonthly(d.monthly, legFilter)
    : d.monthly
  const perfLatest = vActive ? srcMonthly[srcMonthly.length - 1].month : d.latest_date

  const presetDates = getDashboardPresetDates(srcMonthly, range === 'Custom' ? 'All' : range, perfLatest)
  const startDate = customStartDate || presetDates.start
  const endDate = customEndDate || presetDates.end
  const minDate = firstMonthlyDate(srcMonthly)
  const maxDate = lastMonthlyDate(srcMonthly, perfLatest)
  const selectedMonthly = range === 'Custom'
    ? selectDashboardDateRange(srcMonthly, startDate, endDate)
    : selectDashboardRange(srcMonthly, range)
  const rangeStats = buildDashboardRangeStats(selectedMonthly, d.book.base_aum_cr ?? 30)
  // Live, timeframe-aware Max DD from the range-filtered curve (deepest dip of capital+cum equity vs its
  // peak, % of the 30 Cr base). Same formula for fut-only / leg / combined; variants keep their published DD.
  const pairMaxDd = vActive ? Number(vActive.summary.pair_max_dd_pct)
    : capitalMaxDrawdownPct(rangeStats.monthly, d.book.base_aum_cr ?? 30)
  const curveMonthly = rangeStats.monthly
  const heroPath = buildCurvePath(curveMonthly, 560, 70, 4)
  const chartDomain = equityDomain(startDate, endDate, curveMonthly)
  const liveRows = curveMonthly.map(row => ({ date: row.month, value: Number(row.cumulative_inr) || 0 }))
  // Spot backtest overlay only matches the main combined Fut strategy — hide it for variants and leg views.
  const backtestRows = (vActive || legFilter || (futOn && optOn)) ? [] : buildBacktestRows(d.backtest?.series, chartDomain, d.backtest?.base_aum_cr ?? 30)
  const valueDomain = equityValueDomain(liveRows, [])
  const eqPath = buildDateCurvePath(liveRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const backtestPath = buildDateCurvePath(backtestRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const eqPts = dateLinePoints(liveRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const backtestPts = dateLinePoints(backtestRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const timeline = timelineTicks(chartDomain, curveMonthly)
  // Variants precompute correct per-year (compounded) + raw best/worst stats — the shared
  // net_inr-derived stats over-inflate for a compounding series, so use the variant's own.
  const eoyReturns = vActive ? vActive.yearly : yearlyReturns(srcMonthly, d.book.base_aum_cr ?? 30)
  const dispBestMo = vActive ? vActive.summary.best_month_pct : rangeStats.best_month_pct
  const dispWorstMo = vActive ? vActive.summary.worst_month_pct : rangeStats.worst_month_pct
  const dispSharpe = vActive ? vActive.summary.sharpe : rangeStats.sharpe
  const dispWinRate = vActive ? vActive.summary.win_rate : rangeStats.win_rate
  // Heatmap can span many years for long-history variants (e.g. Options 2019→2026) —
  // grow the tile (and its neighbour) and shrink cells so no rows get clipped.
  const heatYears = new Set((curveMonthly || []).map(m => String(m.month).slice(0, 4))).size
  const heatSpan = heatYears >= 7 ? 'span 4' : heatYears >= 5 ? 'span 3' : 'span 2'

  // Fut/Options card filter: union of the checked execution styles (Fut→F2F, Options→F2O).
  // Both checked ⇒ all clients (combined). Capital, Clients and Client Mix follow this.
  const execClients = d.clients.filter(c => {
    const e = c.exec_type || 'F2F'
    return (futOn && e === 'F2F') || (optOn && e === 'F2O')
  })
  const execCapitalCr = execClients.reduce((s, c) => s + c.aum_cr, 0)
  const execExposureCr = execClients.reduce((s, c) => s + Number(c.exposure_cr ?? c.aum_cr), 0)
  const avgLeverage = execClients.length ? execClients.reduce((s, c) => s + (Number(c.leverage) || 0), 0) / execClients.length : 0

  // client mix (of the selected execution style)
  const mix = { Institution: 0, HNI: 0, Retail: 0 }
  let tot = 0
  execClients.forEach(c => { tot += c.aum_cr; mix[c.category] = (mix[c.category] || 0) + c.aum_cr })
  const rPct = tot ? +(mix.Retail / tot * 100).toFixed(1) : 0
  const hPct = tot ? +(mix.HNI / tot * 100).toFixed(1) : 0
  const iPct = tot ? +(mix.Institution / tot * 100).toFixed(1) : 0
  // Client-mix donut — segments sized by CAPITAL share (% of AUM); legend shows that %, hover shows the
  // number of clients in that category.
  const cnt = { Institution: 0, HNI: 0, Retail: 0 }
  execClients.forEach(c => { cnt[c.category] = (cnt[c.category] || 0) + 1 })
  const CMIX = [
    { key: 'retail', name: 'Retail', range: '>₹25L', count: cnt.Retail, pct: rPct, color: '#F97316' },
    { key: 'hni', name: 'HNI', range: '>₹50L', count: cnt.HNI, pct: hPct, color: '#38BDF8' },
    { key: 'inst', name: 'Institution', range: '>₹10Cr', count: cnt.Institution, pct: iPct, color: '#0369A1' },
  ]
  const CMIX_C = 2 * Math.PI * 42   // donut circumference (r=42)

  // Margin is the same transparent rule in Combined, Futures-only and Options-only:
  // 12% of the exact selected exposure shown in Book.
  const marginCr = marginFromExposureCr(execExposureCr)
  const freeCr = Math.max(0, execCapitalCr - marginCr)
  const marginPct = execCapitalCr > 0 ? Math.round(marginCr / execCapitalCr * 100) : 0
  // Long-Short Exposure legs = Quantity × LTP(Future), same qty/LTP as the Open Positions card
  // (base lots scaled to AUM via dispScale). Gross = sum of legs; Net = long − short.
  const legExpInr = p => p ? Math.round((p.lots || 0) * dispScale) * (p.lot_size || 1) * (p.ltp || 0) : 0
  const niftyExpInr = legExpInr(niftyPos)
  const midcapExpInr = legExpInr(midPos)
  const grossExpCr = (niftyExpInr + midcapExpInr) / 1e7
  const netExpCr = ((midPos?.direction === 'LONG' ? midcapExpInr : -midcapExpInr)
                  + (niftyPos?.direction === 'LONG' ? niftyExpInr : -niftyExpInr)) / 1e7

  // gauge arc
  const f = Math.max(0, Math.min(1, book.leverage / 3))
  const th = Math.PI * (1 - f)
  const gx = (52 + 44 * Math.cos(th)).toFixed(1)
  const gy = (51 - 44 * Math.sin(th)).toFixed(1)

  const rangeDt = d.monthly?.length
    ? `${fmtDate(d.monthly[0].month)} → ${fmtDate(d.latest_date)}`
    : '—'
  const selectedRangeDt = startDate && endDate
    ? `${fmtDate(selectedMonthly[0]?.month || startDate)} → ${fmtDate(endDate)}`
    : '—'
  const activeRangeLabel = range === 'All' ? rangeDt : selectedRangeDt
  // "showcasing <first month> – <last month>" derived from the data so it never goes stale.
  const fmtMonYr = (m) => {
    const dt = new Date(String(m || '').slice(0, 10) + 'T00:00:00Z')
    return isNaN(dt) ? '' : dt.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  // Reflect the series actually on screen (variant or live), so the range never contradicts the chart.
  const showcaseSrc = (srcMonthly && srcMonthly.length) ? srcMonthly : d.monthly
  const showcaseFrom = showcaseSrc?.length ? fmtMonYr(showcaseSrc[0].month) : ''
  const showcaseTo   = showcaseSrc?.length ? fmtMonYr(showcaseSrc[showcaseSrc.length - 1].month) : ''

  // Period P&L — current/last month & quarter, from the full monthly series (fixed, not range-dependent).
  // Percentages use the deployed capital (base_aum_cr, ₹30 Cr) — same basis as every other % in the app.
  const baseAumCr = d.book.base_aum_cr ?? 30
  const monthsAll = srcMonthly || []
  const q0 = mo => Math.floor((mo - 1) / 3)                 // 0-based calendar quarter
  const qLabel = (y, q) => `Q${q + 1} '${String(y).slice(2)}`
  const pctOfBase = net => baseAumCr > 0 ? +(net / (baseAumCr * 1e7) * 100).toFixed(2) : 0
  // Work on a raw monthly-% basis so ₹ and % always reconcile — the compounding BankNifty
  // variant has NAV-scaled net_inr that would otherwise not match its raw monthly return.
  const inrOfPct = p => Math.round(p / 100 * baseAumCr * 1e7)
  const periodStat = (() => {
    if (!monthsAll.length) return null
    const last = monthsAll[monthsAll.length - 1]
    const prev = monthsAll.length > 1 ? monthsAll[monthsAll.length - 2] : null
    const ly = +last.month.slice(0, 4), lm = +last.month.slice(5, 7)
    const cq = { y: ly, q: q0(lm) }
    const lq = cq.q > 0 ? { y: ly, q: cq.q - 1 } : { y: ly - 1, q: 3 }
    const inQ = (r, yy, qq) => +r.month.slice(0, 4) === yy && q0(+r.month.slice(5, 7)) === qq
    const sumQpct = (yy, qq) => monthsAll.filter(r => inQ(r, yy, qq)).reduce((s, r) => s + (r.pct || 0), 0)
    const sumQtr = (yy, qq) => monthsAll.filter(r => inQ(r, yy, qq)).reduce((s, r) => s + (r.trades || 0), 0)
    const cqPct = +sumQpct(cq.y, cq.q).toFixed(2), lqPct = +sumQpct(lq.y, lq.q).toFixed(2)
    const mo = r => r ? { month: r.month, pct: r.pct, net_inr: inrOfPct(r.pct), trades: r.trades || 0 } : null
    return {
      curMonth: mo(last), lastMonth: mo(prev),
      cq: { ...cq, net: inrOfPct(cqPct), pct: cqPct, trades: sumQtr(cq.y, cq.q) },
      lq: { ...lq, net: inrOfPct(lqPct), pct: lqPct, trades: sumQtr(lq.y, lq.q) },
    }
  })()
  // Return on AUM: variants carry the true (compounded) total; otherwise sum the monthly net.
  const pctOnAum = vActive ? vActive.summary.return_pct
    : pctOfBase(monthsAll.reduce((s, r) => s + (r.net_inr || 0), 0))
  // Variants/leg views have no live "today" number, so force the overall view.
  // They're not live execution either: variants are spot-backtested, legs are an indicative
  // decomposition of the live book — so we drop the live Realised/Unrealised framing for both.
  const isSynthetic = !!(vActive || legFilter)
  const effMode = (vActive || legFilter) ? 'overall' : mode
  const heroReal = perfScaleInr(effMode === 'overall' ? rangeStats.realised_inr : d.hero.today.realised_inr)  // realised, scaled to the selected styles' capital
  // Overall: open-pair MTM since entry. Today: the live intraday day-move (matches the Today tile).
  const heroUnreal = isSynthetic ? 0
    : effMode === 'overall' ? perfScaleInr(totalUnrealRaw)
    : perfScaleInr(d.hero.today.unrealised_inr ?? d.hero.today.net_inr)
  const heroAmt = heroReal + heroUnreal                     // Net PnL = realised + unrealised
  const heroSince = effMode === 'overall'
    ? `${rangeStats.return_pct}%${vActive ? ` · ${vActive.summary.subtitle}` : legFilter ? ` · ${legLabel} only` : ''}`
    : `${d.hero.today.live ? 'Live' : 'Last trading day'}`
  const heroDateRange = effMode === 'overall' ? activeRangeLabel : fmtDate(d.hero.today.date)

  // Open positions — the live futures pair, sized & marked to the real AUM.
  const shownPos = pos
    .map(p => ({ ...p, lots: Math.round(p.lots * dispScale), unrealised_inr: scaleInr(p.unrealised_inr) }))
  const combinedUnreal = totalUnreal                                   // pair combined P/L (scaled)
  const combinedPct = spreadPct                                        // pair combined % (on deployed base)

  function applyPreset(nextRange) {
    setRange(nextRange)
    setCustomStartDate('')
    setCustomEndDate('')
  }

  function applyStartDate(nextDate) {
    setCustomStartDate(nextDate)
    setCustomEndDate(cur => cur || endDate)
    setRange('Custom')
  }

  function applyEndDate(nextDate) {
    setCustomEndDate(nextDate)
    setCustomStartDate(cur => cur || startDate)
    setRange('Custom')
  }

  return (
    <Frame enteredFromLogin={enteredFromLogin}>
      {/* subbar ticker + controls */}
      <div className="subbar"><div className="in">
        <MarketTickers dash={d} />
        <div className="rt">
          <DateRangeControl
            range={range}
            startDate={startDate}
            endDate={endDate}
            minDate={minDate}
            maxDate={maxDate}
            onPreset={applyPreset}
            onStartDate={applyStartDate}
            onEndDate={applyEndDate}
          />
        </div>
      </div></div>

      <div className="shell">
        <div className="title">{vActive ? `${vActive.summary.name}` : legFilter ? `Pair Trading — ${legLabel}` : 'Pair Trading — Live Book'}</div>

        {/* Index / Instrument variant toggle */}
        <div className="fu" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '16px 0 14px' }}>
          <div className="chips" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.625rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 2 }}>Index</span>
            {[['combined', 'Combined'], ['nifty', 'NIFTY 50'], ['midcap', 'NIFTY MID SELECT'], ['banknifty', 'BANK NIFTY']].map(([k, label]) => (
              <button key={k} disabled={optOn} className={'chip' + (dIndexChip === k ? ' on' : '')}
                onClick={() => !optOn && setDIndexChip(k)}>{label}</button>
            ))}
          </div>
          <div className="chips" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 6 }}>
            <span style={{ fontSize: '0.625rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 2 }}>Instrument</span>
            <button className={'chk' + (futOn ? ' on' : '')} onClick={() => toggleInstr('fut')} role="checkbox" aria-checked={futOn}><span className="box" />Future</button>
            <button className={'chk' + (optOn ? ' on' : '')} onClick={() => toggleInstr('opt')} role="checkbox" aria-checked={optOn}><span className="box" />Options</button>
          </div>
        </div>
        {legFilter && (
          <div className="fu" style={{ background: 'color-mix(in srgb, var(--accent) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)', borderRadius: 8, padding: '9px 14px', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.75rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>Note:</span>
            <span style={{ color: 'var(--muted)' }}>Showing the {legFilter === 'nifty' ? 'Nifty' : 'Midcap'} leg's P&amp;L of the pair — performance panels only; book &amp; positions stay live.</span>
          </div>
        )}

        <div className="heroband fu">
          <div className="hcard main">
            <div className="l hero-title-row">
              <span>{vActive ? `Net PnL — ${vActive.summary.name.replace('Pair Trading — ','')}` : legFilter ? `Net PnL — ${legLabel}` : 'Net PnL — Pair Trading'}</span>
              <span className="hero-title-actions">
                {!isSynthetic && <span className="seg2">
                  <b className={mode === 'overall' ? 'on' : undefined} onClick={() => setMode('overall')}>Overall</b>
                  <b className={mode === 'today' ? 'on' : undefined} onClick={() => setMode('today')}>Today</b>
                </span>}
                <span className="hero-range">{heroDateRange}</span>
              </span>
            </div>
            <div className={'amt' + (heroAmt < 0 ? ' d' : '')}>{heroAmt === 0 ? '₹0' : fInr(heroAmt)}</div>
            <div className="sub">
              {!isSynthetic && <span>Realised <b>{heroReal === 0 ? '₹0' : fInr(heroReal)}</b></span>}
              {!isSynthetic && <span>Unrealised <b className={heroUnreal >= 0 ? 'u' : 'd'}>{heroUnreal === 0 ? '₹0' : fInr(heroUnreal)}</b></span>}
              <span>{heroSince}</span>
            </div>
            <div className="area" style={{ cursor: 'zoom-in' }} onClick={() => setNetModal(true)} title="Click to expand"><svg viewBox="0 0 560 70" preserveAspectRatio="none">
              <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#7DD3FC" stopOpacity=".45" /><stop offset="1" stopColor="#7DD3FC" stopOpacity="0" />
              </linearGradient></defs>
              <path className="entry-hero-fill" d={heroPath.fill} fill="url(#hg)" />
              <path className="entry-hero-line" pathLength="1" d={heroPath.line} fill="none" stroke="#7DD3FC" strokeWidth="2.2" />
            </svg></div>
          </div>

          <div className="hcard">
            <div className="l2">Book</div>
            <div className="row2">
              <Mc l="Capital" v={fmtCr(execCapitalCr)} />
              <Mc l="Gross Exposure" v={fCrb(grossExpCr)} />
              <Mc l="Leverage" v={avgLeverage.toFixed(2) + '×'} />
              <Mc l="Net Exposure" v={fCrb(netExpCr)} />
            </div>
          </div>

          <div className="hcard hclient" onClick={() => setBreakdown(true)} style={{ cursor: 'pointer' }}>
            <div className="l2">Client Mix</div>
            <div className="pcont" style={{ marginTop: 12 }}>
              <div className="cmpie-wrap">
                <svg viewBox="0 0 100 100" className="cmpie">
                  {(() => { let start = 0; return CMIX.map(s => {
                    const len = s.pct / 100 * CMIX_C, rot = start / 100 * 360 - 90
                    start += s.pct
                    return <circle key={s.key} className="seg" cx="50" cy="50" r="42" fill="none"
                      stroke={s.color} strokeWidth={pieHover === s.key ? 21 : 15}
                      strokeDasharray={`${len} ${CMIX_C}`} transform={`rotate(${rot} 50 50)`}
                      onMouseEnter={e => { e.stopPropagation(); setPieHover(s.key) }} onMouseLeave={() => setPieHover(null)} />
                  }) })()}
                </svg>
                <div className="cmc">{pieHover
                  ? (() => { const s = CMIX.find(x => x.key === pieHover); return <><b>{s.count}</b><small>of {execClients.length}</small></> })()
                  : <><b>{execClients.length}</b><small>clients</small></>}</div>
              </div>
              <div className="plg">
                {CMIX.map(s => (
                  <div key={s.key} className={pieHover === s.key ? 'on' : undefined}
                    onMouseEnter={() => setPieHover(s.key)} onMouseLeave={() => setPieHover(null)}>
                    <i style={{ background: s.color }} />{s.name} <small>{s.range}</small><b>{s.pct.toFixed(0)}%</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bento">
          {/* Margin — 12% of the selected Book exposure for every instrument combination. */}
          <div className="t c4 r2 flexcol fu" style={{ animationDelay: '.05s' }}>
            <div className="l">Margin</div>
            <div className="v" style={{ fontSize: '1.125rem' }}>{fCrb(marginCr)}</div>
            <div className="meter" style={{ height: 14 }}><i className="used" style={{ width: `${Math.min(100, marginPct)}%` }}></i><i className="free" style={{ width: `${Math.max(0, 100 - marginPct)}%` }}></i></div>
            <div className="mleg" style={{ fontSize: '0.78125rem', marginTop: 12 }}><span>Used <b>{fCrb(marginCr)}</b></span><span>Free <b>{fCrb(freeCr)}</b></span></div>
            <div className="s" style={{ marginTop: 'auto', marginBottom: 10, fontSize: '0.8125rem' }}>{marginPct}% Utilised</div>
          </div>

          {/* Return on AUM / Avg AUM */}
          <div className="t c3 r2 flexcol fu" style={{ animationDelay: '.06s' }}>
            <div className="l">Absolute Net Return</div>
            <div className={'v ' + (pctOnAum >= 0 ? 'u' : 'd')} style={{ fontSize: '1.625rem', fontWeight: 700, marginTop: 6 }}>{pctOnAum.toFixed(2)}%</div>
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 'auto', paddingTop: 22 }}>
              <div className="s" style={{ margin: 0 }}>Avg AUM deployed</div>
              <div className="m" style={{ fontSize: '1.125rem', fontWeight: 700, marginTop: 10 }}>{fmtCr(perfCapCr)}</div>
            </div>
          </div>

          {/* Exposure by leg — greyed out under Options (no Nifty/Midcap legs in the options strategy) */}
          <div className={'t c5 r2 flexcol fu' + (vActive ? ' card-na' : '')} style={{ animationDelay: '.1s' }}>
            <div className="l">Long-Short Exposure</div>
            {vActive ? (
              <div className="na-note">Not applicable for Options — the Options strategy has no Nifty / Midcap legs.</div>
            ) : (<>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, flex: 1 }}>
                <LegCard name="Nifty" dir={niftyPos?.direction || 'SHORT'} cr={niftyExpInr / 1e7} total={grossExpCr} color="#F97316" />
                <LegCard name="Midcap" dir={midPos?.direction || 'LONG'} cr={midcapExpInr / 1e7} total={grossExpCr} color="#0EA5E9" />
              </div>
            </>)}
          </div>

          {/* Equity curve */}
          <div className="t c7 r3 flexcol fu equity-card">
            <div className="l eq-head">
              <span>Equity Curve{vActive ? <span className="meta"> </span> : legFilter ? <span className="meta"> {legLabel}</span> : null}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className={'v ' + (rangeStats.total_net_inr >= 0 ? 'u' : 'd')} style={{ fontSize: '1.625rem' }}>{fInr(perfScaleInr(rangeStats.total_net_inr))}</div>
              <div className="equity-stats">
                <MiniStat l="Best mo" cls="u" v={dispBestMo.toFixed(2) + '%'} />
                <MiniStat l="Worst Mo" cls="d" v={dispWorstMo.toFixed(2) + '%'} />
                <MiniStat l="Max DD" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
                <MiniStat l="Sharpe" v={dispSharpe.toFixed(2)} color="#0369A1" />
                <MiniStat l="Win rate" cls="u" v={dispWinRate.toFixed(0) + '%'} />
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <div className="line-chart">
                <svg viewBox={`0 0 ${EQ_W} ${EQ_H}`} preserveAspectRatio="none" style={{ width: '100%', height: EQ_H, display: 'block' }}>
                  <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0EA5E9" stopOpacity=".2" /><stop offset="1" stopColor="#0EA5E9" stopOpacity="0" /></linearGradient></defs>
                  <g stroke="#F3EADD" strokeWidth="1"><line x1="0" y1="44" x2={EQ_W} y2="44" /><line x1="0" y1="88" x2={EQ_W} y2="88" /></g>
                  <path d={eqPath.fill} fill="url(#eg)" />
                  <path d={eqPath.line} fill="none" stroke="#0EA5E9" strokeWidth="2.4" />
                  {showBacktest && backtestRows.length > 0 && (
                    <g className="backtest-line">
                      <path d={backtestPath.line} fill="none" stroke="#F97316" strokeWidth="2.1" strokeDasharray="5 4" />
                    </g>
                  )}
                  {equityTip && eqPts[equityTip.index] && (
                    <g className="line-hover">
                      <line x1={eqPts[equityTip.index].x} y1={EQ_PAD} x2={eqPts[equityTip.index].x} y2={EQ_H - EQ_PAD} stroke="#075985" strokeWidth="1" strokeDasharray="3 4" />
                      <circle cx={eqPts[equityTip.index].x} cy={eqPts[equityTip.index].y} r="4" fill="#0EA5E9" stroke="#fff" strokeWidth="2" />
                    </g>
                  )}
                  <rect
                    className="line-hit"
                    x="0"
                    y="0"
                    width={EQ_W}
                    height={EQ_H}
                    onMouseMove={event => setEquityTip(nearestLineTip(event, eqPts, EQ_W, EQ_H, showBacktest ? backtestPts : []))}
                    onMouseLeave={() => setEquityTip(null)}
                  />
                </svg>
                {equityTip && curveMonthly[equityTip.index] && (
                  <FloatingTooltip x={equityTip.clientX} y={equityTip.clientY} className="chart-tooltip">
                    <span>{fmtDate(curveMonthly[equityTip.index].month)}</span>
                    <b>{fInr(perfScaleInr(curveMonthly[equityTip.index].cumulative_inr))}</b>
                    {showBacktest && equityTip.backtestIndex != null && backtestRows[equityTip.backtestIndex] && (
                      <em>Backtest {fInr(perfScaleInr(backtestRows[equityTip.backtestIndex].value))}</em>
                    )}
                  </FloatingTooltip>
                )}
              </div>
              <div className="equity-timeline" aria-label="Equity curve timeline">
                {timeline.map(tick => (
                  <span className="timeline-tick" key={tick.key} style={{ left: `${tick.xPct}%` }}>{tick.label}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: '0.71875rem', fontWeight: 700, color: '#6b6457', marginTop: 'auto', paddingTop: 14 }}>
              <span><i style={{ display: 'inline-block', width: 15, height: 3, borderRadius: 2, background: '#0EA5E9', verticalAlign: 'middle', marginRight: 5 }}></i>Net PnL ({vActive ? 'net' : legFilter ? 'leg' : 'Realised'})</span>
              {backtestRows.length > 0 && (
                <span onClick={() => setShowBacktest(v => !v)} data-tooltip="Click to show or hide Backtest"
                  style={{ cursor: 'pointer', userSelect: 'none', opacity: showBacktest ? 1 : 0.42 }}>
                  <i style={{ display: 'inline-block', width: 15, height: 3, borderRadius: 2, background: '#F97316', verticalAlign: 'middle', marginRight: 5 }}></i>Backtest
                </span>
              )}
            </div>
          </div>

          {/* Yearly returns */}
          <div className="t c5 r3 flexcol fu eoy-card" style={{ animationDelay: '.04s' }}>
            <div className="l" style={{ alignItems: 'flex-start' }}>Yearly Net Return
              <div className="eoy-leg">
                {EOY_SERIES.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}
              </div>
            </div>
            <EoyBars data={eoyReturns} indexYearly={INDEX_YEARLY} centered={futOn && !optOn} />
            <div className="eoy-note">* NIFTY and MIDCAP bars show index Buy &amp; Hold.</div>
          </div>

          {/* Returns heatmap — full width, Monthly / Quarterly toggle */}
          <div className="t c12 flexcol fu" style={{ gridRow: heatSpan }}>
            <div className="l" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{heatMode === 'quarter' ? 'Quarterly' : 'Monthly'} Net Returns</span>
              <div className="chips" style={{ display: 'flex', gap: 6 }}>
                <button className={'chip' + (heatMode === 'month' ? ' on' : '')} onClick={() => setHeatMode('month')}>Monthly</button>
                <button className={'chip' + (heatMode === 'quarter' ? ' on' : '')} onClick={() => setHeatMode('quarter')}>Quarterly</button>
              </div>
            </div>
            <div className="hmx hmx-top" style={{ gridTemplateColumns: `26px repeat(${heatMode === 'quarter' ? 5 : 13},1fr)` }}>
              <span></span>{(heatMode === 'quarter' ? ['Q1', 'Q2', 'Q3', 'Q4'] : ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']).map((m, i) => <span key={i}>{m}</span>)}<span>YEAR</span>
            </div>
            <Heatmap monthly={curveMonthly} compact={heatYears >= 5} mode={heatMode} onCellClick={setMonthModal} />
          </div>

          {/* Latest day */}
          <div className="t c12 todaytile fu">
            <div className="hd"><b><span className="dot"></span>Today</b><span>{fmtDate(d.hero.today.date)}</span></div>
            <div className="cells">
              {/* Live day-move of the open pair (Angel One day-change × qty). Net = Realised + Unrealised;
                  nothing closed today so Realised is 0 and the whole move is unrealised MTM. */}
              <Cell l="Net PnL" v={fInr(scaleInr(d.hero.today.net_inr))} />
              <Cell l="Realised" v={fInr(scaleInr(d.hero.today.realised_inr))} />
              <Cell l="Unrealised" v={fInr(scaleInr(d.hero.today.unrealised_inr ?? d.hero.today.net_inr))} />
              <Cell l="Trades" v={d.hero.today.trades ?? pos.length} />
              <Cell l="Exposure" v={fmtCr(grossExpCr)} />
              <Cell l="Margin" v={fmtCr(marginCr)} />
            </div>
          </div>

          {/* Positions — combined pair, marked to market */}
          <div className="t c12 postile fu" style={{ gridRow: 'span 3' }}>
            <div className="pth"><b>Open Positions</b>
              <div className="lsf">
                <button className={posInstr === 'fut' ? 'on' : undefined} onClick={() => setPosInstr('fut')}>Future</button>
                <button className={posInstr === 'opt' ? 'on' : undefined} onClick={() => setPosInstr('opt')}>Option</button>
              </div>
            </div>
            {posInstr === 'opt' ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: '0.8125rem', padding: '26px 18px' }}>
                The Options variant is an overlay — the live book holds the futures pair only.
              </div>
            ) : (<>
              <div className="tscroll"><table>
                <thead><tr>
                  <th>Client</th><th>Symbol</th><th>Expiry</th><th>Quantity</th><th>Entry</th><th>LTP</th><th>Points</th>
                  <th className="num">Unrealised</th><th className="num">Combined P/L</th><th className="num">Combined %</th>
                </tr></thead>
                <tbody>
                  {shownPos.map((p, i) => {
                    const cc = combinedUnreal >= 0 ? 'u' : 'd'
                    return (
                      <tr key={i}>
                        <td>{p.client}</td>
                        <td className="m">{p.underlying}-FUT</td>
                        <td className="m">{fmtDate(p.expiry)}</td>
                        <td className="m">{(p.lots * (p.lot_size || 1)).toLocaleString('en-IN')}</td>
                        <td className="m">{fmtNum(p.entry_price)}</td>
                        <td className="m">{fmtNum(p.ltp)}</td>
                        <td className={'m ' + (p.points >= 0 ? 'u' : 'd')}>{(p.points < 0 ? '' : '') + p.points.toFixed(1)}</td>
                        <td className={'num m ' + (p.unrealised_inr >= 0 ? 'u' : 'd')}>{fInr(p.unrealised_inr)}</td>
                        {i === 0 && <td className={'num m pair-cell ' + cc} rowSpan={shownPos.length} style={{ verticalAlign: 'middle' }}>{fInr(combinedUnreal)}</td>}
                        {i === 0 && <td className={'num m pair-cell ' + cc} rowSpan={shownPos.length} style={{ verticalAlign: 'middle' }}>{combinedPct.toFixed(2)}%</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
              {shownPos.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: '0.8125rem', padding: 18 }}>No matching positions.</div>}
            </>)}
          </div>
        </div>
      </div>

      {editing && <LeverageModal book={book} baseAum={d.book.aum_cr}
        onSave={(exposure_cr, leverage) => { setLev({ exposure_cr, leverage }); setEditing(false) }}
        onClose={() => setEditing(false)} />}
      {breakdown && <BreakdownModal clients={execClients} onClose={() => setBreakdown(false)} />}
      {netModal && <EquityModal title="Net PnL — Pair Trading" liveRows={liveRows} monthly={curveMonthly} chartDomain={chartDomain}
        valueDomain={valueDomain} timeline={timeline} scaleInr={scaleInr} baseInr={aumBaseInr}
        onClose={() => setNetModal(false)} />}
      {monthModal && <LegPerformanceModal period={monthModal} monthly={curveMonthly} scaleInr={scaleInr} onClose={() => setMonthModal(null)} />}
    </Frame>
  )
}

function Frame({ children, enteredFromLogin }) {
  return <div className={`pg-dash${enteredFromLogin ? ' is-login-entry' : ''}`}>{children}</div>
}
function Ticker({ name, p }) {
  const up = p ? p.points >= 0 : true
  return (
    <div className="ti"><span className="n">{name}</span>
      <span className="v">{p ? fmtNum(p.ltp) : '—'}</span>
      <span className={'c ' + (up ? 'u' : 'd')}>{p ? (up ? '▲' : '▼') + Math.abs(p.points).toFixed(2) : '—'}</span>
    </div>
  )
}
function Mc({ l, v }) {
  return <div className="mc"><div className="l">{l}</div><div className="v">{v}</div></div>
}
function Cell({ l, v }) {
  return <div className="cell"><div className="l">{l}</div><div className="v">{v}</div></div>
}
function PCell({ l, sub, inr, pct, pctOnly, text }) {
  let val, cls = ''
  if (text != null) { val = text }
  else if (pctOnly != null) { val = pctOnly.toFixed(2) + '%'; cls = pctOnly >= 0 ? 'u' : 'd' }
  else if (inr == null) { val = '—' }
  else { val = fInr(inr); cls = inr >= 0 ? 'u' : 'd' }
  return (
    <div className="cell">
      <div className="l">{l}{sub ? <span className="per">{sub}</span> : null}</div>
      <div className={'v ' + cls}>{val}</div>
      {pct != null && inr != null && <div className={'sub ' + cls}>{pct.toFixed(2) + '%'}</div>}
    </div>
  )
}
function LegCard({ name, dir, cr, total, color }) {
  const pct = total > 0 ? (cr / total * 100) : 50
  const isLong = dir === 'LONG'
  return (
    <div style={{ background: 'var(--soft)', borderRadius: 10, padding: '11px 13px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>{name}</span>
        <span className={'tg2 ' + (isLong ? 'l' : 's')} style={{ fontSize: '0.59375rem' }}>{dir}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="m" style={{ fontSize: '1.1875rem', fontWeight: 700 }}>{fCrb(cr)}</div>
        <div style={{ height: 5, borderRadius: 3, background: '#EBDFCE', overflow: 'hidden' }}>
          <i style={{ display: 'block', height: '100%', width: pct + '%', background: color }} />
        </div>
        <div style={{ fontSize: '0.625rem', color: 'var(--muted)', fontWeight: 600 }}>{pct.toFixed(0)}% of gross</div>
      </div>
    </div>
  )
}
function MiniStat({ l, v, cls, color }) {
  return (
    <div className="equity-stat">
      <div className="equity-stat-label">{l}</div>
      <div className={'m equity-stat-value ' + (cls || '')} style={{ color }}>{v}</div>
    </div>
  )
}

function nearestLineTip(event, pts, width, height, overlayPts = []) {
  if (!pts.length) return null
  const rect = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width * width
  let index = 0
  let best = Number.POSITIVE_INFINITY
  pts.forEach((p, i) => {
    const distance = Math.abs(p.x - x)
    if (distance < best) {
      best = distance
      index = i
    }
  })
  const p = pts[index]
  let backtestIndex = null
  if (overlayPts.length) {
    let btBest = Number.POSITIVE_INFINITY
    overlayPts.forEach((point, i) => {
      const distance = Math.abs(point.x - x)
      if (distance < btBest) {
        btBest = distance
        backtestIndex = i
      }
    })
  }
  return { index, backtestIndex, xPct: p.x / width * 100, yPct: p.y / height * 100, clientX: event.clientX, clientY: event.clientY }
}

// Expanded Net PnL modal — the same equity-curve data rendered large, with zoom/pan, ₹/% modes, log
// scale, a drawdown companion panel, a full-range minimap navigator, keyboard nav, and CSV/PNG/HTML
// export. Ported from web-j's EquityModal; the benchmark ("vs Spot" index overlay) and square-off
// event-marker features were dropped — this project has no benchmark series or squareoffs endpoint.
function EquityModal({ title = 'Equity curve', liveRows, monthly, chartDomain, valueDomain, timeline, scaleInr, baseInr = 0, onClose }) {
  useEscClose(onClose)
  const chartRef = useRef(null)
  const [tip, setTip] = useState(null)
  const [zoom, setZoom] = useState(null)   // {start,end} date strings — brush / preset / go-to-date / year-range window
  const [drag, setDrag] = useState(null)   // {i0,i1} row indices while brushing
  const [goDate, setGoDate] = useState('') // "go to date" — pins a crosshair at that date's value
  const [activePreset, setActivePreset] = useState('All')  // which of the 1M/3M/6M/1Y/YTD/All chips is highlighted
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [mode, setMode] = useState('inr')  // inr (₹, rebased to window start) | pct (% return on AUM)
  const [showDD, setShowDD] = useState(false)        // drawdown / underwater companion panel
  const [legs, setLegs] = useState({ nifty: false, midcap: false })   // NIFTY 50 / MIDCAP SELECT spot buy-and-hold overlay lines
  const toggleLeg = k => setLegs(v => ({ ...v, [k]: !v[k] }))
  const [, force] = useState(0)
  useEffect(() => { const onR = () => force(n => n + 1); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR) }, [])
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1440
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 820
  const W = Math.round(Math.min(1440, vw * 0.90))
  const H = Math.round(Math.min(480, vh * 0.48))
  const PAD = 30
  const fullFirst = liveRows[0]?.date, fullLast = liveRows[liveRows.length - 1]?.date
  const addDays = (iso, n) => new Date(dateMs(iso) + n * 86400000).toISOString().slice(0, 10)

  // Cumulative NIFTY 50 / MIDCAP SELECT buy-and-hold spot series (INDEX_YEARLY — same source the
  // Yearly Net Return chart uses), NOT the pair strategy's own leg P&L. One anchor point per calendar
  // year (INDEX_YEARLY's own granularity), placed at that year's last month actually present in
  // `monthly` so a partial current year lines up correctly; the smoothed curve fills in between.
  const buildIndexCumRows = key => {
    const years = [...new Set((monthly || []).map(m => String(m.month).slice(0, 4)))].sort()
    if (!years.length) return []
    let compounded = 1
    const rows = [{ date: `${years[0]}-01-01`, value: 0 }]
    years.forEach(y => {
      const pct = INDEX_YEARLY[y]?.[key]
      if (pct == null) return
      compounded *= (1 + pct / 100)
      const monthsInYear = monthly.filter(m => String(m.month).slice(0, 4) === y).map(m => m.month)
      rows.push({ date: monthsInYear[monthsInYear.length - 1] || `${y}-12-01`, value: baseInr * (compounded - 1) })
    })
    return rows
  }
  const niftyRows = buildIndexCumRows('nifty')
  const midcapRows = buildIndexCumRows('midcap')

  // Current window (zoom / preset / year-range), then transform by mode. ₹ mode REBASES to the
  // window's own start — shows ₹ change since the window began (not the absolute running total) —
  // so the pair curve and either index overlay can share one axis even when their absolute ₹ levels
  // are very different; % mode divides that same delta by AUM.
  const project = rows => {
    const rawR = zoom ? rows.filter(r => r.date >= zoom.start && r.date <= zoom.end) : rows
    const v0 = rawR[0]?.value ?? 0
    let pk = -Infinity
    return rawR.map(r => {
      pk = Math.max(pk, r.value)
      const value = mode === 'inr' ? scaleInr(r.value - v0) : (baseInr > 0 ? scaleInr(r.value - v0) / baseInr * 100 : 0)
      return { date: r.date, value, dd: baseInr > 0 ? scaleInr(r.value - pk) / baseInr * 100 : 0 }
    })
  }
  // Index overlays are already expressed in final ₹ (baseInr-notional), unlike the pair curve which
  // is on the raw base-AUM scale that `scaleInr` converts — so they get the same window-rebase/%
  // treatment without the scaleInr multiplication (which would double-scale them).
  const projectFinal = rows => {
    const rawR = zoom ? rows.filter(r => r.date >= zoom.start && r.date <= zoom.end) : rows
    const v0 = rawR[0]?.value ?? 0
    return rawR.map(r => ({ date: r.date, value: mode === 'inr' ? (r.value - v0) : (baseInr > 0 ? (r.value - v0) / baseInr * 100 : 0) }))
  }
  const dom = zoom ? { start: dateMs(zoom.start), end: Math.max(dateMs(zoom.start) + 86400000, dateMs(zoom.end)) } : chartDomain
  const raw = zoom ? liveRows.filter(r => r.date >= zoom.start && r.date <= zoom.end) : liveRows
  const pRows = project(liveRows)
  const niftyProj = legs.nifty ? projectFinal(niftyRows) : []
  const midcapProj = legs.midcap ? projectFinal(midcapRows) : []
  const vDom = equityValueDomain(pRows, [...niftyProj, ...midcapProj])
  const path = buildDateCurvePath(pRows, dom, vDom, W, H, PAD)
  const pts = dateLinePoints(pRows, dom, vDom, W, H, PAD)
  const niftyPath = niftyProj.length ? buildDateCurvePath(niftyProj, dom, vDom, W, H, PAD) : null
  const midcapPath = midcapProj.length ? buildDateCurvePath(midcapProj, dom, vDom, W, H, PAD) : null
  const tl = adaptiveTicks(dom, pRows.map(r => dateMs(r.date)))
  const zeroY = (vDom.min < 0 && vDom.max > 0) ? H - PAD - (0 - vDom.min) / (vDom.max - vDom.min || 1) * (H - PAD * 2) : null
  const fmtVal = v => v == null ? '—' : (mode === 'inr' ? fmtInr(v).replace(/^\+/, '') : v.toFixed(2) + '%')
  const fmtFull = d => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) } catch { return d } }

  // y-axis gridlines + labels
  const ySpan = (vDom.max - vDom.min) || 1
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const disp = vDom.min + ySpan * i / 4
    return { y: H - PAD - (disp - vDom.min) / ySpan * (H - PAD * 2), label: fmtVal(disp) }
  })

  // Drawdown / underwater companion (dd% already carried per point; always ≤ 0, filled down from the 0 line)
  const DD_H = 92, DD_PAD = 14
  const ddSeries = pRows.map(r => ({ date: r.date, value: r.dd }))
  const ddMin = Math.min(-0.05, ...pRows.map(r => r.dd))
  const ddDom = { min: ddMin, max: 0 }
  const ddPts = dateLinePoints(ddSeries, dom, ddDom, W, DD_H, DD_PAD)
  const ddLine = buildDateCurvePath(ddSeries, dom, ddDom, W, DD_H, DD_PAD).line
  const ddFill = ddPts.length > 1 ? `${ddLine} L${ddPts[ddPts.length - 1].x},${DD_PAD} L${ddPts[0].x},${DD_PAD} Z` : ''
  const maxDD = Math.min(0, ...pRows.map(r => r.dd))

  // Convert an SVG-space point (in the W×H viewBox) to real screen coordinates via the chart
  // wrapper's actual rendered box — lets the tooltip use the same viewport-aware FloatingTooltip
  // as every other chart in the app, instead of a %-based position that can clip at screen edges.
  const toClient = pt => {
    const rect = chartRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left + pt.x / W * rect.width, y: rect.top + pt.y / H * rect.height } : { x: 0, y: 0 }
  }

  // Keyboard: ←/→ step the crosshair, Home/End jump to ends (a11y for the hover tooltip)
  const kbdMove = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const cur = tip?.index ?? (pts.length - 1)
    let ni = e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1 : e.key === 'Home' ? 0 : pts.length - 1
    ni = Math.max(0, Math.min(pts.length - 1, ni))
    const p = pts[ni]; if (!p) return
    const c = toClient(p)
    setTip({ index: ni, clientX: c.x, clientY: c.y })
  }

  // ── Export: CSV (visible window data) + a self-contained interactive HTML ──
  const saveBlob = (blob, name) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1500) }
  const fnameBase = `${title.replace(/[^\w]+/g, '_')}_${raw[0]?.date || ''}_to_${raw[raw.length - 1]?.date || ''}`
  const exportCsv = () => {
    const head = ['Date', mode === 'inr' ? 'Value_INR' : 'Return_pct', 'Drawdown_pct']
    const lines = [head.join(',')]
    pRows.forEach(r => {
      const row = [r.date, mode === 'inr' ? Math.round(r.value) : r.value.toFixed(3), r.dd.toFixed(3)]
      lines.push(row.join(','))
    })
    saveBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `${fnameBase}.csv`)
  }
  // Interactive HTML — a self-contained file that reproduces the web hover (crosshair + tooltip, same
  // values). Point coords + pre-formatted label strings are baked in; a tiny inline script does the hover.
  const exportHtml = () => {
    const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
    const data = pRows.map((r, i) => ({
      x: +pts[i].x.toFixed(2), y: +pts[i].y.toFixed(2),
      d: fmtFull(r.date), v: fmtVal(r.value), up: r.value >= 0,
      dv: i > 0 ? fmtVal(r.value - pRows[i - 1].value) : null, du: i > 0 ? (r.value - pRows[i - 1].value) >= 0 : null,
      dd: r.dd < -0.005 ? r.dd.toFixed(2) + '%' : null,
    }))
    const yg = yTicks.map(t => `<line x1="${PAD}" y1="${t.y}" x2="${W - PAD}" y2="${t.y}" stroke="#F1E9DB" stroke-width="1"/><text x="${W - PAD}" y="${t.y - 3}" font-size="10" text-anchor="end" fill="#9C9384" font-family="monospace" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(t.label)}</text>`).join('')
    const xlabels = tl.map(t => `<span style="position:absolute;left:${(PAD + t.xPct / 100 * (W - 2 * PAD)) / W * 100}%;transform:translateX(-50%)">${esc(t.label)}</span>`).join('')
    const sub = mode === 'inr' ? '₹ P&amp;L' : 'return on AUM'
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(fmtDate(raw[0]?.date))} to ${esc(fmtDate(raw[raw.length - 1]?.date))}</title>
<style>
:root{--tt-bg:#fff;--tt-border:#E7E0D2;--tt-divider:#EFEAE0;--tt-fg:#1A1712;--tt-fg2:#2A2620;--tt-head:#57534E;--tt-label:#736E64;--tt-up:#047857;--tt-dn:#C0392B}
*{box-sizing:border-box}body{margin:0;background:#FBF4EA;color:#1F1B16;font-family:'Segoe UI',Inter,system-ui,sans-serif;padding:22px}
.wrap{max-width:${W}px;margin:0 auto;background:#fff;border:1px solid #ECE2D2;border-radius:14px;padding:16px 18px;box-shadow:0 1px 3px rgba(41,37,32,.06)}
h3{margin:0 0 3px;font-size:15px}.sub{color:#9C9384;font-size:12px;font-weight:600;margin-bottom:12px}
.chart{position:relative;width:100%}svg.main{width:100%;height:${H}px;display:block;cursor:crosshair}
.cross{position:absolute;width:1px;background:#075985;opacity:0;pointer-events:none}
.dot{position:absolute;width:9px;height:9px;border-radius:50%;background:#0EA5E9;border:2px solid #fff;transform:translate(-50%,-50%);opacity:0;pointer-events:none}
.tip{position:absolute;min-width:122px;background:var(--tt-bg);border:1px solid var(--tt-border);border-radius:8px;box-shadow:0 4px 16px rgba(41,37,32,.13),0 1px 4px rgba(41,37,32,.10);padding:9px 11px;font-variant-numeric:tabular-nums;pointer-events:none;opacity:0;transition:opacity .08s;z-index:5}
.tip .d{font-size:12px;font-weight:600;color:var(--tt-head);padding-bottom:5px;margin-bottom:5px;border-bottom:1px solid var(--tt-divider)}
.tip .big{font-family:Consolas,monospace;font-size:17px;font-weight:700}.tip .big.up{color:var(--tt-up)}.tip .big.dn{color:var(--tt-dn)}
.tip .r{display:flex;justify-content:space-between;gap:16px;font-size:12px;margin-top:4px}.tip .r .k{color:var(--tt-label);font-weight:500}.tip .r .v{font-family:Consolas,monospace;font-weight:600;color:var(--tt-fg2)}
.tip .r .v.up{color:var(--tt-up)}.tip .r .v.dn{color:var(--tt-dn)}
.axis{position:relative;height:16px;margin-top:4px;font-family:Consolas,monospace;font-size:10px;font-weight:700;color:#6b6457}
.foot{margin-top:10px;font-size:10.5px;color:#9C9384}
</style></head><body>
<div class="wrap">
<h3>${esc(title)}</h3>
<div class="sub">${esc(fmtDate(raw[0]?.date))} – ${esc(fmtDate(raw[raw.length - 1]?.date))} · ${sub}</div>
<div class="chart" id="c">
<svg class="main" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0EA5E9" stop-opacity=".2"/><stop offset="1" stop-color="#0EA5E9" stop-opacity="0"/></linearGradient></defs>
${yg}<path d="${path.fill}" fill="url(#g)"/><path d="${path.line}" fill="none" stroke="#0EA5E9" stroke-width="2.4"/>
</svg>
<div class="cross" id="cross"></div><div class="dot" id="dot"></div><div class="tip" id="tip"></div>
</div>
<div class="axis">${xlabels}</div>
<div class="foot">Interactive export · hover the chart to read values. Generated by PairDesk.</div>
</div>
<script>
var PTS=${JSON.stringify(data)},W=${W},H=${H};
var c=document.getElementById('c'),cross=document.getElementById('cross'),dot=document.getElementById('dot'),tip=document.getElementById('tip');
function near(px){var lo=0;for(var i=1;i<PTS.length;i++){if(Math.abs(PTS[i].x-px)<Math.abs(PTS[lo].x-px))lo=i;}return lo;}
c.addEventListener('mousemove',function(e){
var r=c.getBoundingClientRect();var i=near((e.clientX-r.left)/r.width*W);var p=PTS[i];
var xpc=p.x/W*100,ypc=p.y/H*100;
cross.style.opacity=1;cross.style.left=xpc+'%';cross.style.top=(H*0.06)+'px';cross.style.height=(H*0.88)+'px';
dot.style.opacity=1;dot.style.left=xpc+'%';dot.style.top=ypc+'%';
var rows='';if(p.dv)rows+='<div class="r"><span class="k">Today</span><span class="v '+(p.du?'up':'dn')+'">'+p.dv+'</span></div>';
if(p.dd)rows+='<div class="r"><span class="k">Drawdown</span><span class="v dn">'+p.dd+'</span></div>';
tip.innerHTML='<div class="d">'+p.d+'</div><div class="big '+(p.up?'up':'dn')+'">'+p.v+'</div>'+rows;
tip.style.opacity=1;tip.style.left=Math.max(9,Math.min(91,xpc))+'%';
tip.style.top=(ypc<44?ypc+5:ypc-5)+'%';tip.style.transform='translate(-50%,'+(ypc<44?'0':'-100%')+')';
});
c.addEventListener('mouseleave',function(){cross.style.opacity=0;dot.style.opacity=0;tip.style.opacity=0;});
</script></body></html>`
    saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fnameBase}.html`)
  }

  // Go to date → ~30-day window centred on the picked date (clamped); crosshair pins on that date.
  useEffect(() => {
    if (!goDate) return
    let s = addDays(goDate, -15), e = addDays(goDate, 15)
    if (fullFirst && s < fullFirst) s = fullFirst
    if (fullLast && e > fullLast) e = fullLast
    setActivePreset(null); setYearFrom(''); setYearTo('')
    setZoom({ start: s, end: e })
  }, [goDate])   // eslint-disable-line
  let goIdx = null
  if (goDate && pRows.length) { let best = Infinity; pRows.forEach((r, i) => { const dd = Math.abs(dateMs(r.date) - dateMs(goDate)); if (dd < best) { best = dd; goIdx = i } }) }

  // Range presets: trailing window / YTD / All (full).
  const preset = k => {
    setGoDate(''); setYearFrom(''); setYearTo('')
    setActivePreset(k)
    if (k === 'All' || !fullLast) { setZoom(null); return }
    let s = k === 'YTD' ? `${fullLast.slice(0, 4)}-01-01` : addDays(fullLast, -({ '1M': 30, '3M': 91, '6M': 182, '1Y': 365 }[k]))   // trailing window (subtract days)
    if (fullFirst && s < fullFirst) s = fullFirst
    setZoom({ start: s, end: fullLast })
  }

  // Year-range picker (beside Drawdown) — one year, or a consecutive span (e.g. 2020–2022, never
  // non-adjacent years like 2021+2023). Two <select>s always resolve to min(from,to)..max(from,to).
  const firstYear = fullFirst ? +fullFirst.slice(0, 4) : null
  const lastYear = fullLast ? +fullLast.slice(0, 4) : null
  const yearOptions = (firstYear != null && lastYear != null)
    ? Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i) : []
  const applyYearRange = (from, to) => {
    if (!from || !to) return
    const f = Math.min(+from, +to), t = Math.max(+from, +to)
    setGoDate(''); setActivePreset(null)
    let s = `${f}-01-01`, e = `${t}-12-31`
    if (fullFirst && s < fullFirst) s = fullFirst
    if (fullLast && e > fullLast) e = fullLast
    setZoom({ start: s, end: e })
  }
  const resetZoom = () => { setZoom(null); setGoDate(''); setYearFrom(''); setYearTo(''); setActivePreset('All') }

  const down = e => { const t = nearestLineTip(e, pts, W, H, []); if (t) { setTip(null); setDrag({ i0: t.index, i1: t.index }) } }
  const move = e => { const t = nearestLineTip(e, pts, W, H, []); if (!t) return; if (drag) setDrag(d => ({ ...d, i1: t.index })); else setTip(t) }
  const up = () => {
    if (drag) {
      const a = Math.min(drag.i0, drag.i1), b = Math.max(drag.i0, drag.i1)
      if (b - a >= 2 && pRows[a] && pRows[b]) {
        setActivePreset(null); setGoDate(''); setYearFrom(''); setYearTo('')
        setZoom({ start: pRows[a].date, end: pRows[b].date })
      }
      setDrag(null)
    }
  }
  const brush = drag && pts[drag.i0] && pts[drag.i1]
    ? { x: Math.min(pts[drag.i0].x, pts[drag.i1].x), w: Math.abs(pts[drag.i1].x - pts[drag.i0].x) } : null

  return (
    <div className="eq-modal-bg" onClick={onClose}>
      <div className="eq-modal" onClick={e => e.stopPropagation()}>
        <div className="eq-modal-head">
          <b>{title}</b>
          <span style={{ marginLeft: 12, fontSize: '0.71875rem', color: 'var(--muted)', fontWeight: 600 }}>
            {zoom ? `${fmtDate(raw[0]?.date)} – ${fmtDate(raw[raw.length - 1]?.date)}` : 'drag to zoom · double-click to reset'}
          </span>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.71875rem', color: 'var(--muted)', fontWeight: 600 }}>
            Go to date
            <input type="date" value={goDate} min={fullFirst} max={fullLast} onChange={e => setGoDate(e.target.value)}
              onClick={e => e.currentTarget.showPicker?.()}
              style={{ padding: '4px 7px', fontSize: '0.75rem', border: '1px solid var(--line)', borderRadius: 8 }} />
            {goDate && <button className="btn ghost" style={{ padding: '4px 9px', fontSize: '0.71875rem' }} onClick={() => { setGoDate(''); resetZoom() }}>×</button>}
          </label>
          <button className="eq-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {/* controls: range presets · ₹/% · legs · year range · drawdown · exports */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '2px 4px 12px', flexWrap: 'wrap' }}>
          <div className="seg">{['1M', '3M', '6M', '1Y', 'YTD', 'All'].map(k => (
            <button key={k} className={activePreset === k ? 'on' : ''} onClick={() => preset(k)}>{k}</button>
          ))}</div>
          <div className="seg">
            <button className={mode === 'inr' ? 'on' : ''} onClick={() => setMode('inr')} title="₹ change since the window start">₹</button>
            <button className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')} title="Return % on AUM, rebased to the visible window">%</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', fontWeight: 700 }}>vs Index</span>
            <button onClick={() => toggleLeg('nifty')} title="Overlay NIFTY 50 buy-and-hold (spot)"
              style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '4px 9px', borderRadius: 8, cursor: 'pointer',
                       border: '1px solid ' + (legs.nifty ? '#38BDF8' : 'var(--line)'), background: legs.nifty ? '#38BDF8' : 'var(--panel)', color: legs.nifty ? '#fff' : 'var(--muted)' }}>
              NIFTY 50
            </button>
            <button onClick={() => toggleLeg('midcap')} title="Overlay MIDCAP SELECT buy-and-hold (spot)"
              style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '4px 9px', borderRadius: 8, cursor: 'pointer',
                       border: '1px solid ' + (legs.midcap ? '#FB923C' : 'var(--line)'), background: legs.midcap ? '#FB923C' : 'var(--panel)', color: legs.midcap ? '#fff' : 'var(--muted)' }}>
              MIDCAP SELECT
            </button>
          </div>
          <div className="seg">
            <button className={showDD ? 'on' : ''} onClick={() => setShowDD(v => !v)} title="Drawdown / underwater panel">Drawdown</button>
          </div>
          {yearOptions.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.71875rem', color: 'var(--muted)', fontWeight: 600 }}>
              Year
              <select value={yearFrom} onChange={e => { const v = e.target.value; setYearFrom(v); applyYearRange(v, yearTo || v); if (!yearTo) setYearTo(v) }}
                style={{ padding: '4px 6px', fontSize: '0.75rem', border: '1px solid var(--line)', borderRadius: 8 }}>
                <option value="">—</option>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              to
              <select value={yearTo} onChange={e => { const v = e.target.value; setYearTo(v); applyYearRange(yearFrom || v, v); if (!yearFrom) setYearFrom(v) }}
                style={{ padding: '4px 6px', fontSize: '0.75rem', border: '1px solid var(--line)', borderRadius: 8 }}>
                <option value="">—</option>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {(yearFrom || yearTo) && <button className="btn ghost" style={{ padding: '4px 9px', fontSize: '0.71875rem' }} onClick={resetZoom}>×</button>}
            </label>
          )}
          <div className="seg" style={{ marginLeft: 'auto' }}>
            <button onClick={exportCsv} title="Download the visible window as CSV">⭳ CSV</button>
            <button onClick={exportHtml} title="Download an interactive HTML file — hover to read the same values offline">⭳ HTML</button>
          </div>
        </div>
        <div style={{ position: 'relative' }} className="eq-chart" ref={chartRef} tabIndex={0} onKeyDown={kbdMove}
          aria-label={`${title} — use left and right arrow keys to read values`}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block', cursor: 'crosshair', userSelect: 'none' }}>
            <defs><linearGradient id="egm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0EA5E9" stopOpacity=".2" /><stop offset="1" stopColor="#0EA5E9" stopOpacity="0" /></linearGradient></defs>
            {/* Full grid — horizontal (value) + vertical (time, aligned to the x-axis ticks below) */}
            {yTicks.map((t, i) => <g key={'y' + i}>
              <line x1={PAD} y1={t.y} x2={W - PAD} y2={t.y} stroke="#F1E9DB" strokeWidth="1" />
              <text x={W - PAD} y={t.y - 3} fontSize="10" textAnchor="end" fill="#9C9384" fontFamily="'JetBrains Mono',monospace"
                stroke="#fff" strokeWidth="3" style={{ paintOrder: 'stroke' }}>{t.label}</text>
            </g>)}
            {tl.map(t => <line key={'x' + t.key} x1={PAD + t.xPct / 100 * (W - 2 * PAD)} y1={PAD} x2={PAD + t.xPct / 100 * (W - 2 * PAD)} y2={H - PAD} stroke="#F1E9DB" strokeWidth="1" />)}
            {zeroY != null && <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 3" />}
            <path d={path.fill} fill="url(#egm)" />
            {midcapPath && <path d={midcapPath.line} fill="none" stroke="#FB923C" strokeWidth="2" strokeDasharray="5 4" />}
            {niftyPath && <path d={niftyPath.line} fill="none" stroke="#38BDF8" strokeWidth="2" strokeDasharray="5 4" />}
            <path d={path.line} fill="none" stroke="#0EA5E9" strokeWidth="2.4" />
            {brush && <rect x={brush.x} y={PAD} width={brush.w} height={H - PAD * 2} fill="#0EA5E9" fillOpacity="0.12" stroke="#0EA5E9" strokeOpacity="0.4" strokeWidth="1" />}
            {goIdx != null && pts[goIdx] && <>
              <line x1={pts[goIdx].x} y1={PAD} x2={pts[goIdx].x} y2={H - PAD} stroke="#D97706" strokeWidth="1.4" />
              <circle cx={pts[goIdx].x} cy={pts[goIdx].y} r="5" fill="#D97706" stroke="#fff" strokeWidth="2" />
            </>}
            {!drag && tip && pts[tip.index] && <>
              <line x1={pts[tip.index].x} y1={PAD} x2={pts[tip.index].x} y2={H - PAD} stroke="#075985" strokeWidth="1" strokeDasharray="3 4" />
              <circle cx={pts[tip.index].x} cy={pts[tip.index].y} r="4.5" fill="#0EA5E9" stroke="#fff" strokeWidth="2" />
            </>}
            <rect x="0" y="0" width={W} height={H} fill="transparent"
              onMouseDown={down} onMouseMove={move} onMouseUp={up}
              onMouseLeave={() => { setTip(null); setDrag(null) }} onDoubleClick={resetZoom} />
          </svg>
          {!drag && tip && pRows[tip.index] && (
            <FloatingTooltip x={tip.clientX} y={tip.clientY} className="chart-tooltip">
              <span>{fmtFull(pRows[tip.index].date)}</span>
              <b className={pRows[tip.index].value >= 0 ? 'u' : 'd'}>{fmtVal(pRows[tip.index].value)}</b>
              {tip.index > 0 && (() => { const dv = pRows[tip.index].value - pRows[tip.index - 1].value; return (
                <em className={dv >= 0 ? 'u' : 'd'}>Today {fmtVal(dv)}</em>) })()}
              {niftyProj[tip.index] && <em style={{ color: '#38BDF8' }}>NIFTY 50 {fmtVal(niftyProj[tip.index].value)}</em>}
              {midcapProj[tip.index] && <em style={{ color: '#FB923C' }}>MIDCAP SELECT {fmtVal(midcapProj[tip.index].value)}</em>}
              {pRows[tip.index].dd < -0.005 && <em className="d">Drawdown {pRows[tip.index].dd.toFixed(2)}%</em>}
            </FloatingTooltip>
          )}
          {goIdx != null && pts[goIdx] && pRows[goIdx] && (() => { const c = toClient(pts[goIdx]); return (
            <FloatingTooltip x={c.x} y={c.y} className="chart-tooltip">
              <span>{fmtFull(pRows[goIdx].date)}</span>
              <b className={pRows[goIdx].value >= 0 ? 'u' : 'd'}>{fmtVal(pRows[goIdx].value)}</b>
            </FloatingTooltip>
          ) })()}
        </div>
        {showDD && (
          <div style={{ position: 'relative', marginTop: 8 }}>
            <div style={{ position: 'absolute', left: 8, top: 3, fontSize: '0.65625rem', fontWeight: 700, color: 'var(--tt-dn)', letterSpacing: '.02em', zIndex: 1 }}>
              Underwater · max drawdown {maxDD.toFixed(2)}%
            </div>
            <svg viewBox={`0 0 ${W} ${DD_H}`} preserveAspectRatio="none" style={{ width: '100%', height: DD_H, display: 'block' }}>
              <line x1={PAD} y1={DD_PAD} x2={W - PAD} y2={DD_PAD} stroke="#E7DED0" strokeWidth="1" />
              {ddFill && <path d={ddFill} fill="#C0392B" fillOpacity="0.12" />}
              <path d={ddLine} fill="none" stroke="#C0392B" strokeWidth="1.6" />
              {!drag && tip && ddPts[tip.index] && <>
                <line x1={ddPts[tip.index].x} y1={DD_PAD} x2={ddPts[tip.index].x} y2={DD_H - DD_PAD} stroke="#C0392B" strokeWidth="1" strokeDasharray="3 4" opacity="0.6" />
                <circle cx={ddPts[tip.index].x} cy={ddPts[tip.index].y} r="3.5" fill="#C0392B" stroke="#fff" strokeWidth="1.5" />
              </>}
              {/* Hover on the underwater panel drives the shared crosshair/readout (hover only, no zoom). */}
              <rect x="0" y="0" width={W} height={DD_H} fill="transparent" style={{ cursor: 'crosshair' }}
                onMouseMove={e => { if (drag) return; const t = nearestLineTip(e, pts, W, H, []); if (t) setTip(t) }}
                onMouseLeave={() => setTip(null)} />
            </svg>
          </div>
        )}
        <div className="equity-timeline">{tl.map(t => <span className="timeline-tick" key={t.key} style={{ left: `${(PAD + t.xPct / 100 * (W - 2 * PAD)) / W * 100}%` }}>{t.label}</span>)}</div>
      </div>
    </div>
  )
}

const EOY_SERIES = [
  { key: 'nifty', name: 'Nifty 50', color: '#38BDF8' },
  { key: 'midcap', name: 'Midcap Select', color: '#FB923C' },
  // { key: 'strategy', name: 'Strategy', color: '#C6DED3' },
  // { key: 'strategy', name: 'Strategy', color: '#3B82F6' },
  { key: 'strategy', name: 'Strategy', color: '#0F8B8D' },
]
// Yearly card: 3 bars per year (Nifty 50 · Midcap Select · Strategy), zero-baseline so negatives
// drop below the line. Index returns from INDEX_YEARLY (buy-and-hold); strategy from `data`.
function EoyBars({ data, indexYearly, centered = false }) {
  const rows = data.map(d => ({
    year: d.year,
    nifty: indexYearly[d.year]?.nifty ?? null,
    midcap: indexYearly[d.year]?.midcap ?? null,
    strategy: d.return_pct,
  }))
  const all = rows.flatMap(r => EOY_SERIES.map(s => r[s.key])).filter(v => v != null)
  const up = Math.max(0.01, ...all.filter(v => v > 0), 0)
  const dn = Math.max(0.01, ...all.filter(v => v < 0).map(v => -v), 0)
  const span = up + dn
  // Where the 0-line sits (from top of plot). Clamped to [20,80] so one dominant year (e.g. a 44%
  // gain) can't squeeze the OTHER side down to a sliver — a small loss still gets a legible band and
  // doesn't end up looking disconnected from the axis, "run off" below the visible bars.
  const zeroPct = dn === 0 ? 100 : up === 0 ? 0 : Math.min(80, Math.max(20, up / span * 100))
  const posBand = zeroPct
  const negBand = 100 - zeroPct
  return (
    <div className={'eoy2' + (rows.length >= 6 ? ' compact' : '') + (centered ? ' centered' : '')}>
      <div className="plot">
        <div className="zero" style={{ top: `${zeroPct}%` }} />
        {rows.map(r => (
          <div className="grp" key={r.year}>
            {EOY_SERIES.map(s => {
              const v = r[s.key]
              if (v == null) return <div className="col" key={s.key} />
              const pos = v >= 0
              const h = pos ? Math.abs(v) / up * posBand : Math.abs(v) / dn * negBand
              const barTop = pos ? zeroPct - h : zeroPct
              const lblTop = pos ? `calc(${barTop}% - 15px)` : `calc(${barTop + h}% + 4px)`
              return (
                <div className="col" key={s.key} data-tooltip={`${r.year} · ${s.name}: ${(pos ? '+' : '') + v.toFixed(2)}%`}>
                  <div className="bar" style={{ background: s.color, top: `${barTop}%`, height: `${h}%` }} />
                  <b className={(pos ? 'u' : 'd') + ' ' + s.key} style={{ top: lblTop }}>{(pos ? '' : '−') + Math.abs(v).toFixed(1) + '%'}</b>
                </div>
              )
            })}
            <span className="yr">{r.year}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
function Pencil({ onClick }) {
  return <span className="ed" style={{ color: 'var(--primary)', cursor: 'pointer' }} onClick={onClick}>✎</span>
}

function Heatmap({ monthly, compact, mode = 'month', onCellClick }) {
  const quarter = mode === 'quarter'
  const map = {}
  monthly.forEach(m => {
    const dt = new Date(m.month)
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1
    if (quarter) {
      const key = `${y}-${Math.ceil(mo / 3)}`       // quarter buckets sum the monthly % (additive)
      map[key] = (map[key] || 0) + (m.pct || 0)
    } else {
      map[`${y}-${mo}`] = m.pct
    }
  })
  // Derive years from the data so variants (which span more years) show their full history.
  const dataYears = [...new Set((monthly || []).map(m => String(m.month).slice(0, 4)))].sort()
  const years = dataYears.length ? dataYears : ['2024', '2025', '2026']
  const n = quarter ? 4 : 12
  return (
    <div className={'hm' + (quarter ? ' hm-q' : '') + (compact ? ' hm-compact' : '')}
      style={{ gridTemplateColumns: `26px repeat(${n + 1},1fr)` }}>
      {years.flatMap(y => {
        const cells = [<div key={y + '-yl'} className="yl">{"'" + y.slice(2)}</div>]
        for (let i = 1; i <= n; i++) {
          const key = `${y}-${i}`
          const pct = key in map ? map[key] : null
          const formatted = pct === null ? '' : formatMonthlyReturn(Math.abs(pct))
          const lbl = pct === null ? '' : (pct >= 0 ? '+' : '−') + formatted
          const tip = pct === null ? 'No data' : (pct >= 0 ? '+' : '−') + formatMonthlyReturn(Math.abs(pct))
          const label = quarter ? `${y} Q${i}` : `${y}-${i < 10 ? '0' : ''}${i}`
          const clickable = pct !== null && !!onCellClick
          const fire = () => {
            if (quarter) {
              const mm = [(i - 1) * 3 + 1, (i - 1) * 3 + 2, (i - 1) * 3 + 3].map(mo => `${y}-${String(mo).padStart(2, '0')}`)
              onCellClick({ months: mm, plabel: `Q${i} ${y}`, quarter: true })
            } else {
              const m = `${y}-${i < 10 ? '0' : ''}${i}`
              onCellClick({ months: [m], plabel: null, month: m, quarter: false })
            }
          }
          cells.push(
            <div key={key} className={'cell' + (clickable ? ' clickable' : '')} style={{ background: hmColor(pct), color: hmText(pct) }}
              data-tooltip={`${label}: ${tip}` + (clickable ? ' · click for leg breakdown' : '')}
              onClick={clickable ? fire : undefined}>{lbl}</div>
          )
        }
        const yearRows = monthly.filter(m => String(m.month).slice(0, 4) === y)
        const yp = compoundYearlyPct(yearRows.map(m => m.pct))
        const yrClickable = yearRows.length > 0 && !!onCellClick
        const fireYear = () => onCellClick({ months: yearRows.map(m => String(m.month).slice(0, 7)), plabel: y, quarter: false })
        cells.push(
          <div key={y + '-yr'} className={'cell yr' + (yrClickable ? ' clickable' : '')} style={{ background: hmColor(yp), color: hmText(yp) }}
            data-tooltip={`${y} (compounded): ${yp >= 0 ? '+' : '−'}${formatMonthlyReturn(Math.abs(yp))}` + (yrClickable ? ' · click for leg breakdown' : '')}
            onClick={yrClickable ? fireYear : undefined}>
            {(yp >= 0 ? '+' : '−') + formatMonthlyReturn(Math.abs(yp))}
          </div>
        )
        return cells
      })}
    </div>
  )
}

function LeverageModal({ book, baseAum, onSave, onClose }) {
  useEscClose(onClose)
  const [expo, setExpo] = useState(book.exposure_cr)
  const [leverage, setLeverage] = useState(book.leverage)
  return (
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose() }}>
      <div className="modal">
        <div className="mh"><b>Edit exposure &amp; leverage</b><span className="x" onClick={onClose}>×</span></div>
        <div style={{ padding: '18px 22px' }}>
          <div className="field"><label>Applies to</label>
            <select defaultValue="pair"><option value="global">Global default</option><option value="pair">Pair Trading (per-strategy override)</option></select>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>Exposure (₹ Cr)</label>
              <input type="number" step="0.1" value={expo}
                onChange={e => { const v = parseFloat(e.target.value) || 0; setExpo(v); setLeverage(+(v / baseAum).toFixed(2)) }} />
            </div>
            <div className="field" style={{ flex: 1 }}><label>Leverage (×)</label>
              <input type="number" step="0.01" value={leverage}
                onChange={e => { const v = parseFloat(e.target.value) || 0; setLeverage(v); setExpo(+(v * baseAum).toFixed(1)) }} />
            </div>
          </div>
          <div className="s" style={{ color: 'var(--muted)', fontWeight: 600, fontSize: '0.75rem' }}>AUM ₹{baseAum.toFixed(1)} Cr fixed · Leverage = Exposure ÷ AUM</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={() => onSave(expo, leverage)}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Client Mix popup only: amounts under ₹1 Cr read better in Lakhs (e.g. 0.8 Cr → 80.0L) than as a
// sub-1 decimal Cr figure. Scoped to this modal — every other Cr display in the app keeps fmtCr.
const fmtCrOrL = cr => cr < 1 ? '₹' + (cr * 100).toFixed(1) + 'L' : fmtCr(cr)

function BreakdownModal({ clients, onClose }) {
  useEscClose(onClose)
  const total = clients.reduce((a, c) => a + c.aum_cr, 0)
  const cats = { Institution: 0, HNI: 0, Retail: 0 }
  clients.forEach(c => { cats[c.category] = (cats[c.category] || 0) + c.aum_cr })
  return (
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose() }}>
      <div className="modal brk-modal">
        <div className="mh"><b>Client breakdown — by capital</b><span className="x" onClick={onClose}>×</span></div>
        <div className="modal-scroll">
          <div className="brk-sub">
            <div><div className="l">Institution</div><div className="v">{fmtCrOrL(cats.Institution || 0)}</div></div>
            <div><div className="l">HNI</div><div className="v">{fmtCrOrL(cats.HNI || 0)}</div></div>
            <div><div className="l">Retail</div><div className="v">{fmtCrOrL(cats.Retail || 0)}</div></div>
            <div><div className="l">Total AUM</div><div className="v">{fmtCrOrL(total)}</div></div>
          </div>
          {clients.map((c, i) => (
            <div className="brk-row" key={i}>
              <span className={'chiplbl ' + CATCLS[c.category]}>{c.category}</span>
              <div style={{ flex: '0 0 180px' }}><b style={{ fontWeight: 700 }}>{c.name}</b><div className="s" style={{ color: 'var(--muted)', fontWeight: 600, fontSize: '0.6875rem' }}>{c.code} · Pair Trading</div></div>
              <div className="bar"><i style={{ width: c.pct + '%', background: CATCOLOR[c.category] }}></i></div>
              <span className="cap">{fmtCrOrL(c.aum_cr)}</span>
              <span className="m" style={{ width: 48, textAlign: 'right', color: 'var(--muted)' }}>{c.pct}%</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 22px', textAlign: 'center', flex: 'none' }}>
          <a href="/clients" className="btn" style={{ textDecoration: 'none', display: 'inline-block' }}>See full Clients page →</a>
        </div>
      </div>
    </div>
  )
}
