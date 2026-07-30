import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import DateRangeControl from '../components/DateRangeControl'
import MarketTickers from '../components/MarketTickers'
import LegPerformanceModal from '../components/LegPerformanceModal'
import { FloatingTooltip } from '../components/ViewportTooltip'
import { fmtDate } from '../lib/format'
import {
  buildDashboardRangeStats,
  firstMonthlyDate,
  getDashboardPresetDates,
  lastMonthlyDate,
  selectDashboardDateRange,
  selectDashboardRange,
} from '../lib/dashboardRange'
import {
  adaptiveTicks,
  buildDateCurvePath,
  compoundYearlyPct,
  dateLinePoints,
  dateMs,
  equityDomain,
  equityValueDomain,
} from '../lib/equityBacktest'
import { extendedRiskMetrics } from '../lib/riskAnalytics'
import { buildCurvePath, hmColor, hmText } from '../lib/curve'
import { combineBacktestMonthly } from '../lib/backtestCombine'
import { INDEX_YEARLY } from '../lib/indexYearly'
import { INDEX_MONTHLY } from '../lib/indexMonthly'
import { formatMonthlyReturn } from '../lib/dashboardPresentation'
import { useEscClose } from '../lib/useEscClose'
import './backtest.css'

const BASE_CR = 30

const fCr = n => `${n < 0 ? '−' : ''}₹${Math.abs(n).toFixed(2)} Cr`
const pctS = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
const uD = n => (n >= 0 ? 'u' : 'd')

const Sc = ({ l, v, cls }) => <div className="sc"><div className="l">{l}</div><div className={'v ' + (cls || '')}>{v}</div></div>
// Bigger "vs NIFTY 50" child card — label, big value, and a small muted sub-caption line
// (e.g. "Nifty: +72.67%", date range, "Q2 2021") — matches pinsec.ai's comparison tile format.
const Vc = ({ l, v, cls, sub }) => (
  <div className="bt-vs-card">
    <div className="l">{l}</div>
    <div className={'v ' + (cls || '')}>{v}</div>
    {sub && <div className="sub">{sub}</div>}
  </div>
)

export default function Backtest() {
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })
  // Pure backtest series — no client, no live LTP. `?frozen=1` skips the futures open-cycle's
  // live-LTP marking (server/src/routes/strategies.js); /api/option-trades never live-marks at all.
  const { data: futData, isError: futErr } = useQuery({ queryKey: ['strategies-frozen'], queryFn: () => apiGet('/api/strategies?frozen=1') })
  const { data: optData, isError: optErr } = useQuery({ queryKey: ['option-trades'], queryFn: () => apiGet('/api/option-trades') })

  const [instr, setInstr] = useState({ fut: true, opt: true })
  const futOn = instr.fut, optOn = instr.opt
  const toggleInstr = key => setInstr(prev => { const next = { ...prev, [key]: !prev[key] }; return (next.fut || next.opt) ? next : prev })

  const [range, setRange] = useState('All')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [netModal, setNetModal] = useState(false)
  const [monthModal, setMonthModal] = useState(null)

  if (futErr || optErr) return <div className="pg-backtest"><div className="shell"><div className="crumb">⚠ Could not load backtest data.</div></div></div>
  if (!futData || !optData) return <div className="pg-backtest"><div className="shell"><div className="crumb">Loading…</div></div></div>

  // "Both" = plain sum of the two 30 Cr blueprints (60 Cr combined base) — a pure backtest merge,
  // not the live client-AUM-weighted combine Dashboard uses (there are no clients here).
  const baseCr = (futOn && optOn) ? BASE_CR * 2 : BASE_CR
  const srcMonthly = (futOn && optOn)
    ? combineBacktestMonthly(futData.monthly, optData.monthly, BASE_CR)
    : futOn ? futData.monthly
    : optData.monthly

  function applyPreset(next) { setRange(next); setCustomStartDate(''); setCustomEndDate('') }
  function applyStartDate(next) { setCustomStartDate(next); setCustomEndDate(cur => cur || endDate); setRange('Custom') }
  function applyEndDate(next) { setCustomEndDate(next); setCustomStartDate(cur => cur || startDate); setRange('Custom') }

  const presetDates = getDashboardPresetDates(srcMonthly, range === 'Custom' ? 'All' : range, lastMonthlyDate(srcMonthly))
  const startDate = customStartDate || presetDates.start
  const endDate = customEndDate || presetDates.end
  const minDate = firstMonthlyDate(srcMonthly)
  const maxDate = lastMonthlyDate(srcMonthly)
  const selectedMonthly = range === 'Custom'
    ? selectDashboardDateRange(srcMonthly, startDate, endDate)
    : selectDashboardRange(srcMonthly, range)

  const stats = buildDashboardRangeStats(selectedMonthly, baseCr)
  const curveMonthly = stats.monthly
  const riskMetrics = extendedRiskMetrics(curveMonthly, baseCr)
  const spark = buildCurvePath(curveMonthly, 700, 54, 4)
  const liveRows = curveMonthly.map(row => ({ date: row.month, value: Number(row.cumulative_inr) || 0 }))
  const chartDomain = equityDomain(startDate, endDate, curveMonthly)

  // Compounded (not summed) yearly return per calendar year present in the visible range, for the
  // Yearly Net Return chart vs INDEX_YEARLY buy-and-hold.
  const years = [...new Set(curveMonthly.map(m => String(m.month).slice(0, 4)))].sort()
  const eoyReturns = years.map(y => ({
    year: y,
    return_pct: compoundYearlyPct(curveMonthly.filter(m => String(m.month).slice(0, 4) === y).map(m => m.pct)),
  }))

  // NIFTY 50 buy-and-hold comparison over the exact months visible in curveMonthly (from
  // INDEX_MONTHLY's real month-end closes) — mirrors pinsec.ai's "strategy simple-summed, index
  // compounded" convention: our own return_pct/cagr_pct above are already on that basis.
  const niftyMonthlyPcts = curveMonthly.map(m => INDEX_MONTHLY[m.month.slice(0, 7)]?.nifty).filter(v => v != null)
  const niftyTotalPct = compoundYearlyPct(niftyMonthlyPcts)
  const niftyYearsSpan = curveMonthly.length / 12
  const niftyCagrPct = niftyYearsSpan > 0 ? (Math.pow(Math.max(0.000001, 1 + niftyTotalPct / 100), 1 / niftyYearsSpan) - 1) * 100 : 0
  const alphaVsNifty = stats.return_pct - niftyTotalPct
  const cagrAlphaVsNifty = riskMetrics.cagr_pct - niftyCagrPct

  // NIFTY 50's own max drawdown over the same months (monthly-resolution compounding — our data
  // granularity, unlike a daily-drawdown figure), for the "Drawdown vs Nifty" comparison tile.
  const niftyMaxDdPct = (() => {
    let cum = 1, peak = 1, maxDD = 0
    niftyMonthlyPcts.forEach(p => {
      cum *= (1 + p / 100)
      peak = Math.max(peak, cum)
      maxDD = Math.min(maxDD, (cum - peak) / peak * 100)
    })
    return maxDD
  })()

  // Best Alpha Quarter — the calendar quarter (within the visible range) where the strategy beat
  // NIFTY 50 by the widest margin, both compounded over that quarter's months.
  const bestAlphaQuarter = (() => {
    const byQuarter = {}
    curveMonthly.forEach(m => {
      const y = m.month.slice(0, 4), q = Math.ceil(+m.month.slice(5, 7) / 3)
      const key = `${y}-Q${q}`
      ;(byQuarter[key] ||= []).push(m.month.slice(0, 7))
    })
    let best = null
    Object.entries(byQuarter).forEach(([key, monthKeys]) => {
      const stratPcts = monthKeys.map(mk => curveMonthly.find(m => m.month.slice(0, 7) === mk)?.pct).filter(v => v != null)
      const niftyPcts = monthKeys.map(mk => INDEX_MONTHLY[mk]?.nifty).filter(v => v != null)
      if (!stratPcts.length || !niftyPcts.length) return
      const alpha = compoundYearlyPct(stratPcts) - compoundYearlyPct(niftyPcts)
      const [yy, qq] = key.split('-Q')
      if (!best || alpha > best.alpha) best = { alpha, label: `Q${qq} ${yy}` }
    })
    return best
  })()

  return (
    <div className="pg-backtest">
      <div className="subbar"><div className="in">
        <MarketTickers dash={dash} />
        <div className="rt">
          <DateRangeControl range={range} startDate={startDate} endDate={endDate} minDate={minDate} maxDate={maxDate}
            onPreset={applyPreset} onStartDate={applyStartDate} onEndDate={applyEndDate} />
        </div>
      </div></div>

      <div className="shell">
        <div className="pagehd fu">
          <div><div className="title">Backtest</div></div>
          <div className="controls">
            <div className="chips">
              <span className="chips-label">Instrument</span>
              <button className={'chip' + (futOn ? ' on' : '')} onClick={() => toggleInstr('fut')}>Futures</button>
              <button className={'chip' + (optOn ? ' on' : '')} onClick={() => toggleInstr('opt')}>Options</button>
            </div>
          </div>
        </div>

        <div className="bt-hero-row">
          <div className="panel scard fu" style={{ animationDelay: '.04s', cursor: 'pointer' }}
            onClick={() => setNetModal(true)} data-tooltip="Click to view full equity curve">
            <div className="hd">
              <div><div className="nm">Pair Trading — Backtest</div><div className="st">Midcap × Nifty · spot-priced · ₹{baseCr} Cr base</div></div>
            </div>
            <div className="statrow bt-hero-statrow">
              <Sc l="Net PnL" cls={uD(stats.total_net_inr)} v={fCr(stats.total_net_inr / 1e7)} />
              <Sc l="Net Return" cls={uD(stats.return_pct)} v={pctS(stats.return_pct)} />
            </div>
            <div className="spark">
              <svg viewBox="0 0 700 54" preserveAspectRatio="none">
                <defs><linearGradient id="btsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0EA5E9" stopOpacity=".22" /><stop offset="1" stopColor="#0EA5E9" stopOpacity="0" /></linearGradient></defs>
                <path d={spark.fill} fill="url(#btsg)" />
                <path d={spark.line} fill="none" stroke="#0EA5E9" strokeWidth="2.2" />
              </svg>
              <div className="legend" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><i style={{ background: '#0EA5E9' }}></i>Cumulative Net PnL</span>
                <span style={{ color: 'var(--primary)', fontWeight: 700 }}>Click to expand ▸</span>
              </div>
            </div>
          </div>

          <div className="panel scard fu" style={{ animationDelay: '.07s' }}>
            <div className="hd">
              <div><div className="nm">Performance Ratios</div><div className="st">Risk-adjusted return &amp; NIFTY 50 alpha</div></div>
            </div>
            <div className="statrow bt-ratio-statrow">
              <Sc l="CAGR" cls={uD(riskMetrics.cagr_pct)} v={`${riskMetrics.cagr_pct.toFixed(2)}%`} />
              <Sc l="Sharpe" v={stats.sharpe} />
              <Sc l="Max DD" cls="d" v={'−' + stats.max_dd_pct.toFixed(2) + '%'} />
              <Sc l="Alpha vs Nifty 50" cls={uD(alphaVsNifty)} v={pctS(alphaVsNifty)} />
              <Sc l="CAGR α vs Nifty" cls={uD(cagrAlphaVsNifty)} v={pctS(cagrAlphaVsNifty)} />
              <Sc l="Win %" v={stats.win_rate + '%'} />
            </div>
          </div>
        </div>

        <div className="panel fu" style={{ marginTop: 14 }}>
          <div className="sechd">Backtest vs NIFTY 50</div>
          <div className="bt-vs-grid">
            <Vc l="Total Return" cls={uD(stats.return_pct)} v={pctS(stats.return_pct)} sub={`${fmtDate(startDate)} → ${fmtDate(endDate)}`} />
            <Vc l="Alpha vs Nifty 50" cls={uD(alphaVsNifty)} v={pctS(alphaVsNifty)} sub={`Nifty: ${pctS(niftyTotalPct)}`} />
            <Vc l="Drawdown vs Nifty" cls="d" v={'−' + stats.max_dd_pct.toFixed(2) + '%'} sub={`Nifty Max: ${niftyMaxDdPct.toFixed(2)}%`} />
            <Vc l="Profit Factor" v={riskMetrics.profit_factor} sub="Gross gain / gross loss" />
            <Vc l="Best Alpha Quarter" cls="u" v={bestAlphaQuarter ? pctS(bestAlphaQuarter.alpha) : '—'} sub={bestAlphaQuarter?.label || 'No data'} />
          </div>
        </div>

        <div className="panel fu" style={{ marginTop: 14 }}>
          <div className="sechd">Yearly Net Return <span className="meta">strategy vs NIFTY / MIDCAP buy &amp; hold</span></div>
          <div style={{ display: 'flex', gap: 14, padding: '0 16px 4px', justifyContent: 'flex-end' }}>
            <span className="eoy-leg-item"><i style={{ background: '#38BDF8' }}></i>Nifty 50</span>
            <span className="eoy-leg-item"><i style={{ background: '#FB923C' }}></i>Midcap Select</span>
            <span className="eoy-leg-item"><i style={{ background: '#0F8B8D' }}></i>Strategy</span>
          </div>
          <EoyBars data={eoyReturns} indexYearly={INDEX_YEARLY} />
        </div>

        <div className="panel fu" style={{ marginTop: 14 }}>
          <div className="sechd">Monthly Net Returns</div>
          <div className="hm-scroll" style={{ padding: '4px 16px 12px' }}>
            <div className="hmx hmx-top" style={{ gridTemplateColumns: '26px repeat(13,1fr)' }}>
              <span></span>{['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].map((m, i) => <span key={i}>{m}</span>)}<span>YEAR</span>
            </div>
            <Heatmap monthly={curveMonthly} onCellClick={setMonthModal} />
          </div>
        </div>
      </div>

      {netModal && (
        <BacktestEquityModal
          liveRows={liveRows}
          monthly={curveMonthly}
          chartDomain={chartDomain}
          baseCr={baseCr}
          onClose={() => setNetModal(false)}
        />
      )}
      {monthModal && <LegPerformanceModal period={monthModal} monthly={curveMonthly} scaleInr={n => n} onClose={() => setMonthModal(null)} />}
    </div>
  )
}

// Expanded equity popup — full parity with Dashboard's EquityModal: drag-to-zoom, range presets,
// ₹/% modes, vs-Index (NIFTY 50 / MIDCAP SELECT buy-and-hold) overlay, a drawdown/underwater
// companion panel, a year-range picker, "go to date", keyboard nav, and CSV/HTML export. Backtest
// has no live client/AUM, so scaleInr is the identity and baseInr is the ₹{baseCr} Cr blueprint base.
function BacktestEquityModal({ liveRows, monthly, chartDomain, baseCr, onClose }) {
  useEscClose(onClose)
  const chartRef = useRef(null)
  const [tip, setTip] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [drag, setDrag] = useState(null)
  const [goDate, setGoDate] = useState('')
  const [activePreset, setActivePreset] = useState('All')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [mode, setMode] = useState('inr')
  const [showDD, setShowDD] = useState(false)
  const [legs, setLegs] = useState({ nifty: false, midcap: false })
  const toggleLeg = k => setLegs(v => ({ ...v, [k]: !v[k] }))
  const [, force] = useState(0)
  useEffect(() => { const onR = () => force(n => n + 1); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR) }, [])
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1440
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 820
  const W = Math.round(Math.min(1440, vw * 0.90))
  const H = Math.round(Math.min(480, vh * 0.48))
  const PAD = 30
  const baseInr = baseCr * 1e7
  const title = 'Backtest Equity Curve'
  const fullFirst = liveRows[0]?.date, fullLast = liveRows[liveRows.length - 1]?.date
  const addDays = (iso, n) => new Date(dateMs(iso) + n * 86400000).toISOString().slice(0, 10)

  // Cumulative NIFTY 50 / MIDCAP SELECT buy-and-hold spot series (INDEX_YEARLY), one anchor point
  // per calendar year placed at that year's last month present in `monthly` — same approach as
  // Dashboard's EquityModal.
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

  const project = rows => {
    const rawR = zoom ? rows.filter(r => r.date >= zoom.start && r.date <= zoom.end) : rows
    const v0 = rawR[0]?.value ?? 0
    let pk = -Infinity
    return rawR.map(r => {
      pk = Math.max(pk, r.value)
      const value = mode === 'inr' ? (r.value - v0) : (baseInr > 0 ? (r.value - v0) / baseInr * 100 : 0)
      return { date: r.date, value, dd: baseInr > 0 ? (r.value - pk) / baseInr * 100 : 0 }
    })
  }
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
  const fmtVal = v => v == null ? '—' : (mode === 'inr' ? fCr(v / 1e7) : v.toFixed(2) + '%')
  const fmtFull = d => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) } catch { return d } }

  const ySpan = (vDom.max - vDom.min) || 1
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const disp = vDom.min + ySpan * i / 4
    return { y: H - PAD - (disp - vDom.min) / ySpan * (H - PAD * 2), label: fmtVal(disp) }
  })

  // Drawdown / underwater companion
  const DD_H = 92, DD_PAD = 14
  const ddSeries = pRows.map(r => ({ date: r.date, value: r.dd }))
  const ddMin = Math.min(-0.05, ...pRows.map(r => r.dd))
  const ddDom = { min: ddMin, max: 0 }
  const ddPts = dateLinePoints(ddSeries, dom, ddDom, W, DD_H, DD_PAD)
  const ddLine = buildDateCurvePath(ddSeries, dom, ddDom, W, DD_H, DD_PAD).line
  const ddFill = ddPts.length > 1 ? `${ddLine} L${ddPts[ddPts.length - 1].x},${DD_PAD} L${ddPts[0].x},${DD_PAD} Z` : ''
  const maxDD = Math.min(0, ...pRows.map(r => r.dd))

  const toClient = pt => {
    const rect = chartRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left + pt.x / W * rect.width, y: rect.top + pt.y / H * rect.height } : { x: 0, y: 0 }
  }

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
    const sub = mode === 'inr' ? '₹ P&amp;L' : `return on ₹${baseCr} Cr base`
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

  const preset = k => {
    setGoDate(''); setYearFrom(''); setYearTo('')
    setActivePreset(k)
    if (k === 'All' || !fullLast) { setZoom(null); return }
    let s = k === 'YTD' ? `${fullLast.slice(0, 4)}-01-01` : addDays(fullLast, -({ '1M': 30, '3M': 91, '6M': 182, '1Y': 365 }[k]))
    if (fullFirst && s < fullFirst) s = fullFirst
    setZoom({ start: s, end: fullLast })
  }

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

  const down = e => { const t = nearestLineTip(e, pts, W, H); if (t) { setTip(null); setDrag({ i0: t.index, i1: t.index }) } }
  const move = e => { const t = nearestLineTip(e, pts, W, H); if (!t) return; if (drag) setDrag(d => ({ ...d, i1: t.index })); else setTip(t) }
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
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '2px 4px 12px', flexWrap: 'wrap' }}>
          <div className="seg">{['1M', '3M', '6M', '1Y', 'YTD', 'All'].map(k => (
            <button key={k} className={activePreset === k ? 'on' : ''} onClick={() => preset(k)}>{k}</button>
          ))}</div>
          <div className="seg">
            <button className={mode === 'inr' ? 'on' : ''} onClick={() => setMode('inr')} title="₹ change since the window start">₹</button>
            <button className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')} title={`Return %, on the ₹${baseCr} Cr base, rebased to the visible window`}>%</button>
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
            <defs><linearGradient id="btegm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0EA5E9" stopOpacity=".2" /><stop offset="1" stopColor="#0EA5E9" stopOpacity="0" /></linearGradient></defs>
            {yTicks.map((t, i) => <g key={'y' + i}>
              <line x1={PAD} y1={t.y} x2={W - PAD} y2={t.y} stroke="#F1E9DB" strokeWidth="1" />
              <text x={W - PAD} y={t.y - 3} fontSize="10" textAnchor="end" fill="#9C9384" fontFamily="'JetBrains Mono',monospace"
                stroke="#fff" strokeWidth="3" style={{ paintOrder: 'stroke' }}>{t.label}</text>
            </g>)}
            {tl.map(t => <line key={'x' + t.key} x1={PAD + t.xPct / 100 * (W - 2 * PAD)} y1={PAD} x2={PAD + t.xPct / 100 * (W - 2 * PAD)} y2={H - PAD} stroke="#F1E9DB" strokeWidth="1" />)}
            {zeroY != null && <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 3" />}
            <path d={path.fill} fill="url(#btegm)" />
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
              <rect x="0" y="0" width={W} height={DD_H} fill="transparent" style={{ cursor: 'crosshair' }}
                onMouseMove={e => { if (drag) return; const t = nearestLineTip(e, pts, W, H); if (t) setTip(t) }}
                onMouseLeave={() => setTip(null)} />
            </svg>
          </div>
        )}
        <div className="equity-timeline">{tl.map(t => <span className="timeline-tick" key={t.key} style={{ left: `${(PAD + t.xPct / 100 * (W - 2 * PAD)) / W * 100}%` }}>{t.label}</span>)}</div>
      </div>
    </div>
  )
}

function nearestLineTip(event, pts, width, height) {
  if (!pts.length) return null
  const rect = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width * width
  let index = 0, best = Number.POSITIVE_INFINITY
  pts.forEach((p, i) => { const distance = Math.abs(p.x - x); if (distance < best) { best = distance; index = i } })
  const p = pts[index]
  return { index, xPct: p.x / width * 100, yPct: p.y / height * 100, clientX: event.clientX, clientY: event.clientY }
}

// ── Yearly Net Return bars — 3 bars per year (Nifty 50 · Midcap Select · Strategy), duplicated from
// Dashboard.jsx's EoyBars (already prop-driven/generic — same convention this codebase uses for
// per-page chart components). Index returns from INDEX_YEARLY (buy-and-hold); strategy from `data`.
const EOY_SERIES = [
  { key: 'nifty', name: 'Nifty 50', color: '#38BDF8' },
  { key: 'midcap', name: 'Midcap Select', color: '#FB923C' },
  { key: 'strategy', name: 'Strategy', color: '#0F8B8D' },
]
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

// ── Monthly Net Returns heatmap — duplicated from Dashboard.jsx's Heatmap (already prop-driven).
// Includes the compounded YEAR column and opens LegPerformanceModal on month/year click, same as
// every other Monthly Net Returns instance in the app.
function Heatmap({ monthly, onCellClick }) {
  const map = {}
  monthly.forEach(m => {
    const dt = new Date(m.month)
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1
    map[`${y}-${mo}`] = m.pct
  })
  const dataYears = [...new Set((monthly || []).map(m => String(m.month).slice(0, 4)))].sort()
  const years = dataYears.length ? dataYears : ['2024', '2025', '2026']
  return (
    <div className="hm" style={{ gridTemplateColumns: '26px repeat(13,1fr)' }}>
      {years.flatMap(y => {
        const cells = [<div key={y + '-yl'} className="yl">{"'" + y.slice(2)}</div>]
        for (let i = 1; i <= 12; i++) {
          const key = `${y}-${i}`
          const pct = key in map ? map[key] : null
          const formatted = pct === null ? '' : formatMonthlyReturn(Math.abs(pct))
          const lbl = pct === null ? '' : (pct >= 0 ? '+' : '−') + formatted
          const tip = pct === null ? 'No data' : (pct >= 0 ? '+' : '−') + formatMonthlyReturn(Math.abs(pct))
          const label = `${y}-${i < 10 ? '0' : ''}${i}`
          const clickable = pct !== null && !!onCellClick
          const fire = () => {
            const m = `${y}-${i < 10 ? '0' : ''}${i}`
            onCellClick({ months: [m], plabel: null, month: m, quarter: false })
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

        // NIFTY 50 buy-and-hold sub-row directly under this year's strategy row (INDEX_MONTHLY).
        const niftyCells = [<div key={y + '-nyl'} className="yl nifty-yl">Nifty</div>]
        for (let i = 1; i <= 12; i++) {
          const mk = `${y}-${i < 10 ? '0' : ''}${i}`
          const npct = INDEX_MONTHLY[mk]?.nifty
          const nlbl = npct == null ? '' : (npct >= 0 ? '+' : '−') + formatMonthlyReturn(Math.abs(npct))
          const ntip = npct == null ? 'No data' : `NIFTY 50 ${mk}: ${(npct >= 0 ? '+' : '−') + formatMonthlyReturn(Math.abs(npct))}`
          niftyCells.push(<div key={mk + '-n'} className="cell nifty-cell" data-tooltip={ntip}>{nlbl}</div>)
        }
        const niftyYearPcts = Array.from({ length: 12 }, (_, i) => INDEX_MONTHLY[`${y}-${String(i + 1).padStart(2, '0')}`]?.nifty).filter(v => v != null)
        const niftyYp = niftyYearPcts.length ? compoundYearlyPct(niftyYearPcts) : null
        niftyCells.push(
          <div key={y + '-nyr'} className="cell nifty-cell yr"
            data-tooltip={niftyYp == null ? 'No data' : `NIFTY 50 ${y} (compounded): ${(niftyYp >= 0 ? '+' : '−') + formatMonthlyReturn(Math.abs(niftyYp))}`}>
            {niftyYp == null ? '' : (niftyYp >= 0 ? '+' : '−') + formatMonthlyReturn(Math.abs(niftyYp))}
          </div>
        )
        return [...cells, ...niftyCells]
      })}
    </div>
  )
}
