import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import DateRangeControl from '../components/DateRangeControl'
import { fmtInr, fmtCr, fmtDate, fmtNum } from '../lib/format'
import { buildCurvePath, hmColor, hmText } from '../lib/curve'
import {
  buildDashboardRangeStats,
  firstMonthlyDate,
  getDashboardPresetDates,
  lastMonthlyDate,
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
import { yearlyReturns } from '../lib/riskAnalytics'

const CATCOLOR = { Institution: '#0EA5E9', HNI: '#38BDF8', Retail: '#F97316' }
const CATCLS = { Institution: 'inst', HNI: 'hni', Retail: 'retail' }
const IDX = ['All Indices', 'NIFTY 50', 'NIFTY MIDCAP SELECT', 'Combined (pair)']
const EQ_W = 700
const EQ_H = 70
const EQ_PAD = 6

export default function Dashboard() {
  const { data: d, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet('/api/dashboard'),
  })

  const [mode, setMode] = useState('overall')   // overall | today
  const [side, setSide] = useState('all')        // all | long | short
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

  if (isError) return <div className="shell"><div className="crumb">⚠ Could not reach API — is the server running on :3002? ({String(error?.message)})</div></div>
  if (!d) return <div className="shell"><div className="crumb">Loading…</div></div>

  const book = { ...d.book, ...(lev || {}) }
  const pos = d.positions || []
  const niftyPos = pos.find(p => p.underlying === 'NIFTY') || null
  const midPos = pos.find(p => p.underlying === 'MIDCPNIFTY') || null
  const totalUnreal = (niftyPos?.unrealised_inr || 0) + (midPos?.unrealised_inr || 0)
  const spreadPct = totalUnreal / d.book.aum_cr / 1e7 * 100

  const presetDates = getDashboardPresetDates(d.monthly, range === 'Custom' ? 'All' : range, d.latest_date)
  const startDate = customStartDate || presetDates.start
  const endDate = customEndDate || presetDates.end
  const minDate = firstMonthlyDate(d.monthly)
  const maxDate = lastMonthlyDate(d.monthly, d.latest_date)
  const selectedMonthly = range === 'Custom'
    ? selectDashboardDateRange(d.monthly, startDate, endDate)
    : selectDashboardRange(d.monthly, range)
  const rangeStats = buildDashboardRangeStats(selectedMonthly, d.book.base_aum_cr ?? 30)
  const pairMaxDd = Number(d.stats?.pair_max_dd_pct ?? d.stats?.max_dd_pct ?? rangeStats.max_dd_pct)
  const curveMonthly = rangeStats.monthly
  const heroPath = buildCurvePath(curveMonthly, 560, 70, 4)
  const chartDomain = equityDomain(startDate, endDate, curveMonthly)
  const liveRows = curveMonthly.map(row => ({ date: row.month, value: Number(row.cumulative_inr) || 0 }))
  const backtestRows = buildBacktestRows(d.backtest?.series, chartDomain, d.backtest?.base_aum_cr ?? 30)
  const valueDomain = equityValueDomain(liveRows, [])
  const eqPath = buildDateCurvePath(liveRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const backtestPath = buildDateCurvePath(backtestRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const eqPts = dateLinePoints(liveRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const backtestPts = dateLinePoints(backtestRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const timeline = timelineTicks(chartDomain, curveMonthly)
  const eoyReturns = yearlyReturns(d.monthly, d.book.base_aum_cr ?? 30)

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
  const showcaseFrom = d.monthly?.length ? fmtMonYr(d.monthly[0].month) : ''
  const showcaseTo   = d.monthly?.length ? fmtMonYr(d.monthly[d.monthly.length - 1].month) : ''
  const heroAmt = mode === 'overall' ? rangeStats.total_net_inr : d.hero.today.net_inr
  const heroReal = mode === 'overall' ? rangeStats.realised_inr : d.hero.today.realised_inr
  const heroSince = mode === 'overall'
    ? `${rangeStats.return_pct >= 0 ? '+' : ''}${rangeStats.return_pct}% · ${activeRangeLabel}`
    : `last trading day · ${fmtDate(d.hero.today.date)}`

  // positions filtered
  const shownPos = pos.filter(p => {
    const s = p.direction === 'LONG' ? 'long' : 'short'
    const sideOk = side === 'all' || s === side
    const qOk = !q || (p.client || '').toLowerCase().includes(q.toLowerCase())
    return sideOk && qOk
  })

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
        <Ticker name="NIFTY 50" p={niftyPos} />
        <Ticker name="MIDCAP SELECT" p={midPos} />
        <div className="ti"><span className="n">PAIR SPREAD</span>
          <span className="v">{(spreadPct >= 0 ? '+' : '') + spreadPct.toFixed(2)}%</span>
          <span className={'c ' + (spreadPct >= 0 ? 'u' : 'd')}>{spreadPct >= 0 ? '▲' : '▼'}</span>
        </div>
        <div className="rt">
          <div className="gl" style={{ background: '#fff', padding: '6px 11px', position: 'relative' }}
            onClick={e => { e.stopPropagation(); setIdxOpen(o => !o) }}>
            <span>{idx}</span> ▾
            {idxOpen && (
              <div className="menu" style={{ top: 38, right: 0 }}>
                {IDX.map(o => (
                  <button key={o} className={o === idx ? 'on' : undefined}
                    onClick={e => { e.stopPropagation(); setIdx(o); setIdxOpen(false) }}>{o}</button>
                ))}
              </div>
            )}
          </div>
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
        <div className="title">Pair Trading — Live Book</div>
        <div className="crumb">Midcap × Nifty · latest trading day {fmtDate(d.latest_date)} · showcasing {showcaseFrom} – {showcaseTo}</div>

        <div className="heroband fu">
          <div className="hcard main">
            <div className="l">Net PnL — Pair Trading <span className="seg2">
              <b className={mode === 'overall' ? 'on' : undefined} onClick={() => setMode('overall')}>Overall</b>
              <b className={mode === 'today' ? 'on' : undefined} onClick={() => setMode('today')}>Today</b>
            </span></div>
            <div className={'amt' + (heroAmt < 0 ? ' d' : '')}>{heroAmt === 0 ? '₹0' : fmtInr(heroAmt)}</div>
            <div className="sub">
              <span>Realised <b>{heroReal === 0 ? '₹0' : fmtInr(heroReal)}</b></span>
              <span>Unrealised <b>₹0</b></span>
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
              <Mc l="AUM" v={fmtCr(book.aum_cr)} />
              <Mc l={<>Exposure <Pencil onClick={() => setEditing(true)} /></>} v={fmtCr(book.exposure_cr)} />
              <Mc l="Clients" v={book.clients} />
              <Mc l="Strategies" v={book.strategies} />
            </div>
          </div>

          <div className="hcard">
            <div className="l2">Leverage <Pencil onClick={() => setEditing(true)} /></div>
            <div className="gauge"><svg viewBox="0 0 104 56">
              <path d="M8,51 A44,44 0 0,1 96,51" fill="none" stroke="#F2E7D6" strokeWidth="9" strokeLinecap="round" />
              <path d={`M8,51 A44,44 0 0,1 ${gx},${gy}`} fill="none" stroke="url(#gg)" strokeWidth="9" strokeLinecap="round" />
              <defs><linearGradient id="gg"><stop offset="0" stopColor="#F97316" /><stop offset="1" stopColor="#38BDF8" /></linearGradient></defs>
            </svg><div className="gv">{book.leverage.toFixed(2)}×</div></div>
            <div className="row2" style={{ marginTop: 8 }}>
              <Mc l="Sharpe" v={rangeStats.sharpe.toFixed(2)} />
              <Mc l="Win rate" v={rangeStats.win_rate.toFixed(0) + '%'} />
            </div>
          </div>
        </div>

        <div className="bento">
          {/* Equity curve */}
          <div className="t c7 r2 flexcol fu equity-card">
            <div className="l eq-head">
              <span>Equity Curve <span className="meta">net realised · monthly</span></span>
              <button className={'bt-toggle ' + (showBacktest ? 'on' : '')} onClick={() => setShowBacktest(v => !v)}>
                <span></span> Backtest
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className={'v ' + (rangeStats.total_net_inr >= 0 ? 'u' : 'd')} style={{ fontSize: 26 }}>{fmtInr(rangeStats.total_net_inr)}</div>
              <div style={{ display: 'flex', gap: 7 }}>
                <MiniStat l="Best mo" cls="u" v={(rangeStats.best_month_pct >= 0 ? '+' : '') + rangeStats.best_month_pct.toFixed(2) + '%'} />
                <MiniStat l="Worst" cls="d" v={(rangeStats.worst_month_pct >= 0 ? '+' : '') + rangeStats.worst_month_pct.toFixed(2) + '%'} />
                <MiniStat l="Max DD" cls="d" v={'−' + pairMaxDd.toFixed(1) + '%'} />
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
                    <b>{fmtInr(curveMonthly[equityTip.index].cumulative_inr)}</b>
                    {showBacktest && equityTip.backtestIndex != null && backtestRows[equityTip.backtestIndex] && (
                      <em>Backtest {fmtInr(backtestRows[equityTip.backtestIndex].value)}</em>
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
              <span><i style={{ display: 'inline-block', width: 15, height: 3, borderRadius: 2, background: '#0EA5E9', verticalAlign: 'middle', marginRight: 5 }}></i>Net PnL (realised)</span>
              {showBacktest && <span><i style={{ display: 'inline-block', width: 15, height: 3, borderRadius: 2, background: '#F97316', verticalAlign: 'middle', marginRight: 5 }}></i>Spot backtest</span>}
            </div>
          </div>

          {/* Yearly returns */}
          <div className="t c5 r2 flexcol fu" style={{ animationDelay: '.04s' }}>
            <div className="l">Yearly Return <span className="meta">calendar year · net</span></div>
            <EoyBars data={eoyReturns} />
          </div>

          {/* Client mix */}
          <div className="t c5 r2 flexcol fu" style={{ animationDelay: '.05s' }}>
            <div className="l">Client Mix <span className="meta">{d.clients.length} · by capital</span></div>
            <div className="pcont">
              <div className="pie" style={{ background: pieBg }}><div className="c"><b>{d.clients.length}</b><small>clients</small></div></div>
              <div className="plg">
                <div><i style={{ background: '#F97316' }}></i>Retail <small>&lt;₹5Cr</small><b>{rPct}%</b></div>
                <div><i style={{ background: '#38BDF8' }}></i>HNI <small>5–100Cr</small><b>{hPct}%</b></div>
                <div><i style={{ background: '#0EA5E9' }}></i>Institution <small>&gt;100Cr</small><b>{iPct}%</b></div>
              </div>
            </div>
            <div className="va" onClick={() => setBreakdown(true)}>Open client breakdown ↗</div>
          </div>

          {/* Monthly heatmap */}
          <div className="t c7 r2 flexcol fu">
            <div className="l">Monthly Returns <span className="meta">by entry month</span></div>
            <Heatmap monthly={curveMonthly} />
            <div className="hmx"><span></span>{['J','F','M','A','M','J','J','A','S','O','N','D'].map((m, i) => <span key={i}>{m}</span>)}</div>
          </div>

          {/* Margin */}
          <div className="t c5 r2 flexcol fu" style={{ animationDelay: '.05s' }}>
            <div className="l">Margin</div>
            <div className="v" style={{ fontSize: 18 }}>{fmtCr(marginCr)}</div>
            <div className="meter"><i className="used" style={{ width: '25%' }}></i><i className="free" style={{ width: '75%' }}></i></div>
            <div className="mleg"><span>Used <b>{fmtCr(marginCr)}</b></span><span>Free <b>{fmtCr(freeCr)}</b></span></div>
            <div className="s" style={{ marginTop: 'auto' }}>25% utilised · EOD</div>
          </div>

          {/* Exposure by leg */}
          <div className="t c9 flexcol fu" style={{ animationDelay: '.1s' }}>
            <div className="l">Exposure by leg</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
              <div><div className="s" style={{ margin: 0 }}>Nifty ({(niftyPos?.direction || 'SHORT').toLowerCase()})</div><div className="m" style={{ fontSize: 14, fontWeight: 600 }}>{fmtCr(half)}</div></div>
              <div><div className="s" style={{ margin: 0 }}>Midcap ({(midPos?.direction || 'LONG').toLowerCase()})</div><div className="m" style={{ fontSize: 14, fontWeight: 600 }}>{fmtCr(half)}</div></div>
            </div>
          </div>

          {/* Latest day */}
          <div className="t c12 todaytile fu">
            <div className="hd"><b><span className="dot"></span>Latest Day</b><span>{fmtDate(d.hero.today.date)}</span></div>
            <div className="cells">
              <Cell l="Net PnL" v={fmtInr(d.hero.today.net_inr)} />
              <Cell l="Realised" v={fmtInr(d.hero.today.realised_inr)} />
              <Cell l="Unrealised" v="₹0" />
              <Cell l="Trades" v={d.hero.today.trades ?? pos.length} />
              <Cell l="Exposure" v={fmtCr(book.exposure_cr)} />
              <Cell l="Margin" v={fmtCr(book.aum_cr * 0.25)} />
            </div>
          </div>

          {/* Positions */}
          <div className="t c12 postile fu" style={{ gridRow: 'span 3' }}>
            <div className="pth"><b>Open Positions</b>
              <input className="srch" placeholder="⌕ Search client…" style={{ fontFamily: 'inherit', outline: 'none' }}
                value={q} onChange={e => setQ(e.target.value)} />
              <div className="lsf">
                {['all', 'long', 'short'].map(s => (
                  <button key={s} className={s === side ? 'on' : undefined} onClick={() => setSide(s)}>
                    {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="tscroll"><table>
              <thead><tr><th>Client</th><th>Symbol</th><th>Expiry</th><th>Side</th><th>Lots</th><th>Entry</th><th>LTP</th><th>Points</th><th>Unrealised</th></tr></thead>
              <tbody>
                {shownPos.map((p, i) => (
                  <tr key={i}>
                    <td>{p.client}</td>
                    <td className="m">{p.underlying}-FUT</td>
                    <td className="m">{fmtDate(p.expiry)}</td>
                    <td><span className={'tg2 ' + (p.direction === 'LONG' ? 'l' : 's')}>{p.direction}</span></td>
                    <td className="m">{p.lots.toLocaleString('en-IN')}</td>
                    <td className="m">{fmtNum(p.entry_price)}</td>
                    <td className="m">{fmtNum(p.ltp)}</td>
                    <td className={'m ' + (p.points >= 0 ? 'u' : 'd')}>{(p.points >= 0 ? '+' : '') + p.points.toFixed(1)}</td>
                    <td className={'m ' + (p.unrealised_inr >= 0 ? 'u' : 'd')}>{fmtInr(p.unrealised_inr)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {shownPos.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: 13, padding: 18 }}>No matching positions.</div>}
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

function EoyBars({ data }) {
  const max = Math.max(...data.map(row => Math.abs(row.return_pct)), 1)
  return (
    <div className="eoy-bars">
      {data.map(row => {
        const h = Math.max(8, Math.abs(row.return_pct) / max * 100)
        const up = row.return_pct >= 0
        return (
          <div className="eoy-bar" key={row.year}>
            <div className="barbox" data-tip={`${row.year}: ${(up ? '+' : '') + row.return_pct.toFixed(2)}%, net ${fmtInr(row.net_inr)}`}>
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

function Heatmap({ monthly }) {
  const map = {}
  monthly.forEach(m => { const dt = new Date(m.month); map[`${dt.getUTCFullYear()}-${dt.getUTCMonth() + 1}`] = m.pct })
  const years = ['2024', '2025', '2026']
  return (
    <div className="hm">
      {years.flatMap(y => {
        const cells = [<div key={y + '-yl'} className="yl">{"'" + y.slice(2)}</div>]
        for (let mo = 1; mo <= 12; mo++) {
          const key = `${y}-${mo}`
          const pct = key in map ? map[key] : null
          const lbl = pct === null ? '' : (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(2) + '%'
          const tip = pct === null ? 'No data' : (pct >= 0 ? '+' : '') + pct.toFixed(3) + '%'
          cells.push(
            <div key={key} className="cell" style={{ background: hmColor(pct), color: hmText(pct) }}
              title={`${y}-${mo < 10 ? '0' : ''}${mo}: ${tip}`}>{lbl}</div>
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
