import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import DateRangeControl from '../components/DateRangeControl'
import MarketTickers from '../components/MarketTickers'
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
  buildBacktestRows,
  buildDateCurvePath,
  dateLinePoints,
  equityDomain,
  equityValueDomain,
  timelineTicks,
} from '../lib/equityBacktest'
import { capitalMaxDrawdownPct, yearlyReturns } from '../lib/riskAnalytics'
import { VARIANTS } from '../lib/variantData'

const CATCOLOR = { Institution: '#0EA5E9', HNI: '#38BDF8', Retail: '#F97316' }
const CATCLS = { Institution: 'inst', HNI: 'hni', Retail: 'retail' }
const IDX = ['All Indices', 'NIFTY 50', 'NIFTY MIDCAP SELECT', 'Combined (pair)']
const EQ_W = 700
const EQ_H = 104
const EQ_PAD = 8

export default function Dashboard() {
  const { data: d, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet('/api/dashboard'),
  })

  const [mode, setMode] = useState('overall')   // overall | today
  const [posInstr, setPosInstr] = useState('fut') // fut | opt (Open Positions instrument)
  const [q, setQ] = useState('')
  const [range, setRange] = useState('All')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [idx, setIdx] = useState('All Indices')
  const [idxOpen, setIdxOpen] = useState(false)
  const [lev, setLev] = useState(null)           // {exposure_cr, leverage} override
  const [editing, setEditing] = useState(false)
  const [breakdown, setBreakdown] = useState(false)
  const [equityTip, setEquityTip] = useState(null)
  const [showBacktest, setShowBacktest] = useState(true)
  const [dIndexChip, setDIndexChip] = useState('combined')  // combined | nifty | midcap | banknifty
  const [dInstrMode, setDInstrMode] = useState('fut')        // fut | opt
  const [heatMode, setHeatMode] = useState('month')          // month | quarter (Monthly Returns view)

  if (isError) return <div className="shell"><div className="crumb">⚠ Could not reach API — is the server running on :3002? ({String(error?.message)})</div></div>
  if (!d) return <div className="shell"><div className="crumb">Loading…</div></div>

  const book = { ...d.book, ...(lev || {}) }
  // The backtest/book is calibrated at ₹30 Cr (base_aum_cr). The actual deployed AUM is the sum
  // of active clients (book.aum_cr). We keep every % on the 30 Cr base (scale-invariant) but
  // SCALE the displayed ₹ to the real AUM, so the dashboard reflects the capital actually
  // deployed instead of looking hardcoded at ₹30 Cr. dispScale = AUM / 30.
  const dispBaseCr = d.book.base_aum_cr ?? 30
  const dispAumCr = (book.aum_cr && book.aum_cr > 0) ? book.aum_cr : dispBaseCr   // fall back to base if no AUM
  const dispScale = dispBaseCr > 0 ? dispAumCr / dispBaseCr : 1
  const scaleInr = v => Math.round((v || 0) * dispScale)
  const pos = d.positions || []
  const niftyPos = pos.find(p => p.underlying === 'NIFTY') || null
  const midPos = pos.find(p => p.underlying === 'MIDCPNIFTY') || null
  const totalUnrealRaw = (niftyPos?.unrealised_inr || 0) + (midPos?.unrealised_inr || 0)
  const totalUnreal = scaleInr(totalUnrealRaw)      // open-position mark-to-market, scaled to AUM
  const spreadPct = totalUnrealRaw / dispBaseCr / 1e7 * 100

  // Variant toggle: Options / BankNifty swap the PERFORMANCE data (curve, heatmap, yearly,
  // hero PnL) to hardcoded verified showcase data. The live book (positions, clients, margin)
  // stays as-is. Default (Combined + Fut) → vActive null → identical to before.
  const vActive = dInstrMode === 'opt' ? VARIANTS.options
    : dIndexChip === 'banknifty' ? VARIANTS.banknifty
    : null
  // Fut + Nifty/Midcap chip → show that leg of the pair only (options disables the index chips).
  const legFilter = (dInstrMode === 'fut' && (dIndexChip === 'nifty' || dIndexChip === 'midcap')) ? dIndexChip : null
  const legLabel = legFilter === 'nifty' ? 'NIFTY 50 leg' : legFilter === 'midcap' ? 'NIFTY Midcap Select leg' : null
  const srcMonthly = vActive ? vActive.monthly : legFilter ? legMonthly(d.monthly, legFilter) : d.monthly
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
  const pairMaxDd = vActive ? Number(vActive.summary.pair_max_dd_pct)
    : legFilter ? capitalMaxDrawdownPct(rangeStats.monthly, d.book.base_aum_cr ?? 30)
    : Number(d.stats?.pair_max_dd_pct ?? d.stats?.max_dd_pct ?? rangeStats.max_dd_pct)
  const curveMonthly = rangeStats.monthly
  const heroPath = buildCurvePath(curveMonthly, 560, 70, 4)
  const chartDomain = equityDomain(startDate, endDate, curveMonthly)
  const liveRows = curveMonthly.map(row => ({ date: row.month, value: Number(row.cumulative_inr) || 0 }))
  // Spot backtest overlay only matches the main combined Fut strategy — hide it for variants and leg views.
  const backtestRows = (vActive || legFilter) ? [] : buildBacktestRows(d.backtest?.series, chartDomain, d.backtest?.base_aum_cr ?? 30)
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
  const heatSpan = heatYears >= 5 ? 'span 3' : 'span 2'

  // client mix
  const mix = { Institution: 0, HNI: 0, Retail: 0 }
  let tot = 0
  d.clients.forEach(c => { tot += c.aum_cr; mix[c.category] = (mix[c.category] || 0) + c.aum_cr })
  const rPct = +(mix.Retail / tot * 100).toFixed(1)
  const hPct = +(mix.HNI / tot * 100).toFixed(1)
  const iPct = +(mix.Institution / tot * 100).toFixed(1)
  const pieBg = `conic-gradient(#F97316 0 ${rPct}%,#38BDF8 ${rPct}% ${rPct + hPct}%,#0EA5E9 ${rPct + hPct}% 100%)`

  // margin (approx 25% of AUM = SPAN initial)
  const marginCr = book.aum_cr * 0.25
  const freeCr = book.aum_cr - marginCr
  const half = book.exposure_cr / 2

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
  const heroReal = scaleInr(effMode === 'overall' ? rangeStats.realised_inr : d.hero.today.realised_inr)  // realised, scaled to AUM
  const heroUnreal = isSynthetic ? 0 : totalUnreal          // open-position mark-to-market (already scaled)
  const heroAmt = heroReal + heroUnreal                     // Net PnL = realised + unrealised
  const heroSince = effMode === 'overall'
    ? `${rangeStats.return_pct >= 0 ? '+' : ''}${rangeStats.return_pct}% · ${vActive ? vActive.summary.subtitle : legFilter ? legLabel + ' only' : activeRangeLabel}`
    : `last trading day · ${fmtDate(d.hero.today.date)}`

  // Open positions — the live futures pair, sized & marked to the real AUM.
  const shownPos = pos
    .filter(p => !q || (p.client || '').toLowerCase().includes(q.toLowerCase()))
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
    <Frame>
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
          <div className="seg">
            <button className={mode === 'overall' ? 'on' : undefined} onClick={() => setMode('overall')}>Overall</button>
            <button className={mode === 'today' ? 'on' : undefined} onClick={() => setMode('today')}>Today</button>
          </div>
        </div>
      </div></div>

      <div className="shell">
        <div className="title">{vActive ? `${vActive.summary.name} (spot-backtested)` : legFilter ? `Pair Trading — ${legLabel} leg (indicative)` : 'Pair Trading — Live Book'}</div>
        <div className="crumb">Midcap × Nifty · {isSynthetic ? '' : `latest trading day ${fmtDate(d.latest_date)} · `}showcasing {showcaseFrom} – {showcaseTo}{vActive ? ' · spot-backtested' : legFilter ? ' · indicative' : ''}</div>

        {/* Index / Instrument variant toggle */}
        <div className="fu" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '10px 0 4px' }}>
          <div className="chips" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 2 }}>Index</span>
            {[['combined', 'Combined'], ['nifty', 'NIFTY 50'], ['midcap', 'NIFTY MID SELECT'], ['banknifty', 'BANK NIFTY']].map(([k, label]) => (
              <button key={k} disabled={dInstrMode === 'opt'} className={'chip' + (dIndexChip === k ? ' on' : '')}
                onClick={() => dInstrMode !== 'opt' && setDIndexChip(k)}>{label}</button>
            ))}
          </div>
          <div className="chips" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 2 }}>Instrument</span>
            <button className={'chip' + (dInstrMode === 'fut' ? ' on' : '')} onClick={() => setDInstrMode('fut')}>Fut</button>
            <button className={'chip' + (dInstrMode === 'opt' ? ' on' : '')} onClick={() => setDInstrMode('opt')}>Options</button>
          </div>
        </div>
        {vActive && (
          <div className="fu" style={{ background: 'color-mix(in srgb, var(--primary) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 28%, transparent)', borderRadius: 8, padding: '9px 14px', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{vActive.summary.name}</span>
            <span style={{ color: 'var(--muted)' }}>{vActive.summary.subtitle} · backtested variant, indicative on ₹{dispAumCr} Cr (performance panels only — book &amp; positions stay live)</span>
          </div>
        )}
        {legFilter && (
          <div className="fu" style={{ background: 'color-mix(in srgb, var(--accent) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)', borderRadius: 8, padding: '9px 14px', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{legLabel} only</span>
            <span style={{ color: 'var(--muted)' }}>Showing the {legFilter === 'nifty' ? 'Nifty' : 'Midcap'} leg's P&amp;L of the pair — performance panels only; book &amp; positions stay live.</span>
          </div>
        )}

        <div className="heroband fu">
          <div className="hcard main">
            <div className="l">{vActive ? 'Net PnL — spot-backtested' : legFilter ? 'Net PnL — indicative leg' : 'Net PnL — Pair Trading'} {!isSynthetic && <span className="seg2">
              <b className={mode === 'overall' ? 'on' : undefined} onClick={() => setMode('overall')}>Overall</b>
              <b className={mode === 'today' ? 'on' : undefined} onClick={() => setMode('today')}>Today</b>
            </span>}</div>
            <div className={'amt' + (heroAmt < 0 ? ' d' : '')}>{heroAmt === 0 ? '₹0' : fmtInr(heroAmt)}</div>
            <div className="sub">
              {!isSynthetic && <span>Realised <b>{heroReal === 0 ? '₹0' : fmtInr(heroReal)}</b></span>}
              {!isSynthetic && <span>Unrealised <b className={heroUnreal >= 0 ? 'u' : 'd'}>{heroUnreal === 0 ? '₹0' : fmtInr(heroUnreal)}</b></span>}
              <span>{heroSince}</span>
            </div>
            <div className="area"><svg viewBox="0 0 560 70" preserveAspectRatio="none">
              <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#38BDF8" stopOpacity=".5" /><stop offset="1" stopColor="#38BDF8" stopOpacity="0" />
              </linearGradient></defs>
              <path d={heroPath.fill} fill="url(#hg)" />
              <path d={heroPath.line} fill="none" stroke="#7DD3FC" strokeWidth="2.2" />
            </svg></div>
          </div>

          <div className="hcard">
            <div className="l2">Book</div>
            <div className="row2">
              <Mc l="Capital" v={fmtCr(book.aum_cr)} />
              <Mc l={<>Exposure <Pencil onClick={() => setEditing(true)} /></>} v={fmtCr(book.exposure_cr)} />
              <Mc l="Clients" v={book.clients} />
              <Mc l="Strategies" v={book.strategies} />
            </div>
          </div>

          <div className="hcard hclient" onClick={() => setBreakdown(true)} style={{ cursor: 'pointer' }}>
            <div className="l2">Client Mix <span className="e">{d.clients.length} · by capital ↗</span></div>
            <div className="pcont" style={{ marginTop: 12 }}>
              <div className="pie" style={{ background: pieBg }}><div className="c"><b>{d.clients.length}</b><small>clients</small></div></div>
              <div className="plg">
                <div><i style={{ background: '#F97316' }}></i>Retail <small>&lt;₹5Cr</small><b>{rPct}%</b></div>
                <div><i style={{ background: '#38BDF8' }}></i>HNI <small>5–100Cr</small><b>{hPct}%</b></div>
                <div><i style={{ background: '#0EA5E9' }}></i>Institution <small>&gt;100Cr</small><b>{iPct}%</b></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bento">
          {/* Margin */}
          <div className="t c4 r2 flexcol fu" style={{ animationDelay: '.05s' }}>
            <div className="l">Margin</div>
            <div className="v" style={{ fontSize: 18 }}>{fmtCr(marginCr)}</div>
            <div className="meter"><i className="used" style={{ width: '25%' }}></i><i className="free" style={{ width: '75%' }}></i></div>
            <div className="mleg"><span>Used <b>{fmtCr(marginCr)}</b></span><span>Free <b>{fmtCr(freeCr)}</b></span></div>
            <div className="s" style={{ marginTop: 'auto' }}>25% utilised · EOD</div>
          </div>

          {/* Return on AUM / Avg AUM */}
          <div className="t c3 r2 flexcol fu" style={{ animationDelay: '.06s' }}>
            <div className="l">Net Return on AUM</div>
            <div className={'v ' + (pctOnAum >= 0 ? 'u' : 'd')} style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{(pctOnAum >= 0 ? '+' : '') + pctOnAum.toFixed(2)}%</div>
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 'auto', paddingTop: 10 }}>
              <div className="s" style={{ margin: 0 }}>Avg AUM · deployed</div>
              <div className="m" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{fmtCr(dispAumCr)}</div>
            </div>
          </div>

          {/* Exposure by leg */}
          <div className="t c5 r2 flexcol fu" style={{ animationDelay: '.1s' }}>
            <div className="l">Exposure by leg</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, flex: 1 }}>
              <LegCard name="Nifty" dir={niftyPos?.direction || 'SHORT'} cr={half} total={book.exposure_cr} color="#F97316" />
              <LegCard name="Midcap" dir={midPos?.direction || 'LONG'} cr={half} total={book.exposure_cr} color="#0EA5E9" />
            </div>
            <div className="mleg" style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <span>Gross exposure <b>{fmtCr(book.exposure_cr)}</b></span>
              <span>Net (L−S) <b>{fmtCr(0)}</b></span>
              <span>Leverage <b>{book.leverage.toFixed(2)}×</b></span>
            </div>
          </div>

          {/* Equity curve */}
          <div className="t c7 r3 flexcol fu equity-card">
            <div className="l eq-head">
              <span>Equity Curve{vActive ? <span className="meta"> spot-backtested</span> : legFilter ? <span className="meta"> indicative leg</span> : null}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className={'v ' + (rangeStats.total_net_inr >= 0 ? 'u' : 'd')} style={{ fontSize: 26 }}>{fmtInr(scaleInr(rangeStats.total_net_inr))}</div>
              <div style={{ display: 'flex', gap: 7 }}>
                <MiniStat l="Best mo" cls="u" v={(dispBestMo >= 0 ? '+' : '') + dispBestMo.toFixed(2) + '%'} />
                <MiniStat l="Worst" cls="d" v={(dispWorstMo >= 0 ? '+' : '') + dispWorstMo.toFixed(2) + '%'} />
                <MiniStat l="Max DD" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
                <MiniStat l="Sharpe" v={dispSharpe.toFixed(2)} />
                <MiniStat l="Win rate" cls="u" v={dispWinRate.toFixed(0) + '%'} />
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <div className="line-chart">
                <svg viewBox={`0 0 ${EQ_W} ${EQ_H}`} preserveAspectRatio="none" style={{ width: '100%', height: EQ_H, display: 'block' }}>
                  <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0EA5E9" stopOpacity=".2" /><stop offset="1" stopColor="#0EA5E9" stopOpacity="0" /></linearGradient></defs>
                  <g stroke="#F3EADD" strokeWidth="1"><line x1="0" y1="27" x2={EQ_W} y2="27" /><line x1="0" y1="54" x2={EQ_W} y2="54" /></g>
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
                  <div className={'line-tip ' + (equityTip.yPct < 38 ? 'below' : 'above')} style={{ left: `${equityTip.xPct}%`, top: `${equityTip.yPct}%` }}>
                    <span>{fmtDate(curveMonthly[equityTip.index].month)}</span>
                    <b>{fmtInr(scaleInr(curveMonthly[equityTip.index].cumulative_inr))}</b>
                    {showBacktest && equityTip.backtestIndex != null && backtestRows[equityTip.backtestIndex] && (
                      <em>Spot benchmark {fmtInr(scaleInr(backtestRows[equityTip.backtestIndex].value))}</em>
                    )}
                  </div>
                )}
              </div>
              <div className="equity-timeline" aria-label="Equity curve timeline">
                {timeline.map(tick => (
                  <span className="timeline-tick" key={tick.key} style={{ left: `${tick.xPct}%` }}>{tick.label}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11.5, fontWeight: 700, color: '#6b6457', marginTop: 6 }}>
              <span><i style={{ display: 'inline-block', width: 15, height: 3, borderRadius: 2, background: '#0EA5E9', verticalAlign: 'middle', marginRight: 5 }}></i>Net PnL ({vActive ? 'spot-backtested' : legFilter ? 'indicative leg' : 'realised'})</span>
              {backtestRows.length > 0 && (
                <span onClick={() => setShowBacktest(v => !v)} title="Click to show/hide the spot benchmark"
                  style={{ cursor: 'pointer', userSelect: 'none', opacity: showBacktest ? 1 : 0.42 }}>
                  <i style={{ display: 'inline-block', width: 15, height: 3, borderRadius: 2, background: '#F97316', verticalAlign: 'middle', marginRight: 5 }}></i>Spot benchmark
                </span>
              )}
            </div>
          </div>

          {/* Yearly returns */}
          <div className="t c5 r3 flexcol fu" style={{ animationDelay: '.04s' }}>
            <div className="l">Yearly Net Return</div>
            <EoyBars data={eoyReturns} scale={dispScale} />
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
            <Heatmap monthly={curveMonthly} compact={heatYears >= 5} mode={heatMode} />
            <div className="hmx" style={heatMode === 'quarter' ? { gridTemplateColumns: '26px repeat(4,1fr)' } : undefined}>
              <span></span>{(heatMode === 'quarter' ? ['Q1','Q2','Q3','Q4'] : ['J','F','M','A','M','J','J','A','S','O','N','D']).map((m, i) => <span key={i}>{m}</span>)}
            </div>
          </div>

          {/* Latest day */}
          <div className="t c12 todaytile fu">
            <div className="hd"><b><span className="dot"></span>Today</b><span>{fmtDate(d.hero.today.date)}</span></div>
            <div className="cells">
              <Cell l="Net PnL" v={fmtInr(scaleInr(d.hero.today.net_inr) + totalUnreal)} />
              <Cell l="Realised" v={fmtInr(scaleInr(d.hero.today.realised_inr))} />
              <Cell l="Unrealised" v={fmtInr(totalUnreal)} />
              <Cell l="Trades" v={d.hero.today.trades ?? pos.length} />
              <Cell l="Exposure" v={fmtCr(dispAumCr)} />
              <Cell l="Margin" v={fmtCr(dispAumCr * 0.25)} />
            </div>
          </div>

          {/* Positions — combined pair, marked to market */}
          <div className="t c12 postile fu" style={{ gridRow: 'span 3' }}>
            <div className="pth"><b>Open Positions</b>
              <input className="srch" placeholder="⌕ Search client…" style={{ fontFamily: 'inherit', outline: 'none' }}
                value={q} onChange={e => setQ(e.target.value)} />
              <div className="lsf">
                <button className={posInstr === 'fut' ? 'on' : undefined} onClick={() => setPosInstr('fut')}>Fut</button>
                <button className={posInstr === 'opt' ? 'on' : undefined} onClick={() => setPosInstr('opt')}>Option</button>
              </div>
            </div>
            {posInstr === 'opt' ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: 13, padding: '26px 18px' }}>
                The Options variant is a spot-backtested overlay — the live book holds the futures pair only.
              </div>
            ) : (<>
              <div className="tscroll"><table>
                <thead><tr>
                  <th>Client</th><th>Symbol</th><th>Expiry</th><th>Lots</th><th>Entry</th><th>LTP</th><th>Points</th>
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
                        <td className="m">{p.lots.toLocaleString('en-IN')}</td>
                        <td className="m">{fmtNum(p.entry_price)}</td>
                        <td className="m">{fmtNum(p.ltp)}</td>
                        <td className={'m ' + (p.points >= 0 ? 'u' : 'd')}>{(p.points >= 0 ? '+' : '') + p.points.toFixed(1)}</td>
                        <td className={'num m ' + (p.unrealised_inr >= 0 ? 'u' : 'd')}>{fmtInr(p.unrealised_inr)}</td>
                        {i === 0 && <td className={'num m pair-cell ' + cc} rowSpan={shownPos.length} style={{ verticalAlign: 'middle' }}>{fmtInr(combinedUnreal)}</td>}
                        {i === 0 && <td className={'num m pair-cell ' + cc} rowSpan={shownPos.length} style={{ verticalAlign: 'middle' }}>{(combinedPct >= 0 ? '+' : '') + combinedPct.toFixed(2)}%</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
              {shownPos.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: 13, padding: 18 }}>No matching positions.</div>}
            </>)}
          </div>
        </div>
      </div>

      {editing && <LeverageModal book={book} baseAum={d.book.aum_cr}
        onSave={(exposure_cr, leverage) => { setLev({ exposure_cr, leverage }); setEditing(false) }}
        onClose={() => setEditing(false)} />}
      {breakdown && <BreakdownModal clients={d.clients} onClose={() => setBreakdown(false)} />}
    </Frame>
  )
}

function Frame({ children }) {
  return <div className="pg-dash">{children}</div>
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
  else if (pctOnly != null) { val = (pctOnly >= 0 ? '+' : '') + pctOnly.toFixed(2) + '%'; cls = pctOnly >= 0 ? 'u' : 'd' }
  else if (inr == null) { val = '—' }
  else { val = fmtInr(inr); cls = inr >= 0 ? 'u' : 'd' }
  return (
    <div className="cell">
      <div className="l">{l}{sub ? <span className="per">{sub}</span> : null}</div>
      <div className={'v ' + cls}>{val}</div>
      {pct != null && inr != null && <div className={'sub ' + cls}>{(pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'}</div>}
    </div>
  )
}
function LegCard({ name, dir, cr, total, color }) {
  const pct = total > 0 ? (cr / total * 100) : 50
  const isLong = dir === 'LONG'
  return (
    <div style={{ background: 'var(--soft)', borderRadius: 10, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{name}</span>
        <span className={'tg2 ' + (isLong ? 'l' : 's')} style={{ fontSize: 9.5 }}>{dir}</span>
      </div>
      <div className="m" style={{ fontSize: 19, fontWeight: 700 }}>{fmtCr(cr)}</div>
      <div style={{ height: 5, borderRadius: 3, background: '#EBDFCE', overflow: 'hidden' }}>
        <i style={{ display: 'block', height: '100%', width: pct + '%', background: color }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{pct.toFixed(0)}% of gross</div>
    </div>
  )
}
function MiniStat({ l, v, cls }) {
  return (
    <div style={{ background: 'var(--soft)', borderRadius: 10, padding: '6px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
      <div className={'m ' + cls} style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
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
  return { index, backtestIndex, xPct: p.x / width * 100, yPct: p.y / height * 100 }
}

function EoyBars({ data, scale = 1 }) {
  const max = Math.max(...data.map(row => Math.abs(row.return_pct)), 1)
  return (
    <div className="eoy-bars">
      {data.map(row => {
        const h = Math.max(8, Math.abs(row.return_pct) / max * 100)
        const up = row.return_pct >= 0
        return (
          <div className="eoy-bar" key={row.year}>
            <div className="barbox" data-tip={`${row.year}: ${(up ? '+' : '') + row.return_pct.toFixed(2)}%, net ${fmtInr(Math.round(row.net_inr * scale))}`}>
              <i className={up ? 'u' : 'd'} style={{ height: h + '%' }}></i>
            </div>
            <b className={up ? 'u' : 'd'}>{(up ? '+' : '') + row.return_pct.toFixed(2)}%</b>
            <span>{row.year}</span>
          </div>
        )
      })}
    </div>
  )
}
function Pencil({ onClick }) {
  return <span className="ed" style={{ color: 'var(--primary)', cursor: 'pointer' }} onClick={onClick}>✎</span>
}

function Heatmap({ monthly, compact, mode = 'month' }) {
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
      style={quarter ? { gridTemplateColumns: '26px repeat(4,1fr)' } : undefined}>
      {years.flatMap(y => {
        const cells = [<div key={y + '-yl'} className="yl">{"'" + y.slice(2)}</div>]
        for (let i = 1; i <= n; i++) {
          const key = `${y}-${i}`
          const pct = key in map ? map[key] : null
          const lbl = pct === null ? '' : (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(2) + '%'
          const tip = pct === null ? 'No data' : (pct >= 0 ? '+' : '') + pct.toFixed(3) + '%'
          const label = quarter ? `${y} Q${i}` : `${y}-${i < 10 ? '0' : ''}${i}`
          cells.push(
            <div key={key} className="cell" style={{ background: hmColor(pct), color: hmText(pct) }}
              title={`${label}: ${tip}`}>{lbl}</div>
          )
        }
        return cells
      })}
    </div>
  )
}

function LeverageModal({ book, baseAum, onSave, onClose }) {
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
          <div className="s" style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>AUM ₹{baseAum.toFixed(1)} Cr fixed · Leverage = Exposure ÷ AUM</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={() => onSave(expo, leverage)}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BreakdownModal({ clients, onClose }) {
  const total = clients.reduce((a, c) => a + c.aum_cr, 0)
  const cats = { Institution: 0, HNI: 0, Retail: 0 }
  clients.forEach(c => { cats[c.category] = (cats[c.category] || 0) + c.aum_cr })
  return (
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose() }}>
      <div className="modal">
        <div className="mh"><b>Client breakdown — by capital</b><span className="x" onClick={onClose}>×</span></div>
        <div className="brk-sub">
          <div><div className="l">Institution</div><div className="v">{fmtCr(cats.Institution || 0)}</div></div>
          <div><div className="l">HNI</div><div className="v">{fmtCr(cats.HNI || 0)}</div></div>
          <div><div className="l">Retail</div><div className="v">{fmtCr(cats.Retail || 0)}</div></div>
          <div><div className="l">Total AUM</div><div className="v">{fmtCr(total)}</div></div>
        </div>
        {clients.map((c, i) => (
          <div className="brk-row" key={i}>
            <span className={'chiplbl ' + CATCLS[c.category]}>{c.category}</span>
            <div style={{ flex: '0 0 180px' }}><b style={{ fontWeight: 700 }}>{c.name}</b><div className="s" style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 11 }}>{c.code} · Pair Trading</div></div>
            <div className="bar"><i style={{ width: c.pct + '%', background: CATCOLOR[c.category] }}></i></div>
            <span className="cap">{fmtCr(c.aum_cr)}</span>
            <span className="m" style={{ width: 48, textAlign: 'right', color: 'var(--muted)' }}>{c.pct}%</span>
          </div>
        ))}
        <div style={{ padding: '14px 22px', textAlign: 'center' }}>
          <a href="/clients" className="btn" style={{ textDecoration: 'none', display: 'inline-block' }}>See full Clients page →</a>
        </div>
      </div>
    </div>
  )
}
