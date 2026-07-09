import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import DateRangeControl from '../components/DateRangeControl'
import { buildCurvePath, hmColor, hmText } from '../lib/curve'
import { fmtNum } from '../lib/format'
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
import {
  buildCapitalDrawdownSeries,
  extendedRiskMetrics,
  returnQuantiles,
  rollingSharpe,
  worstDrawdowns,
  yearlyReturns,
} from '../lib/riskAnalytics'
import './strategies.css'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const monthLabel = m => { const d = new Date(m + 'T00:00:00'); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
const monthShort = m => { const d = new Date(m + 'T00:00:00'); return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` }
const fCr = n => `${n >= 0 ? '+' : '−'}₹${Math.abs(n).toFixed(2)} Cr`
const pctS = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
const uD = n => (n >= 0 ? 'u' : 'd')
const EQ_W = 760
const EQ_H = 150
const EQ_PAD = 8

export default function Strategies() {
  const { data, isError, error } = useQuery({ queryKey: ['strategies'], queryFn: () => apiGet('/api/strategies') })
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })
  const [range, setRange] = useState('All')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [equityTip, setEquityTip] = useState(null)
  const [showBacktest, setShowBacktest] = useState(true)
  const [showDetailedStats, setShowDetailedStats] = useState(false)
  const [indexChip, setIndexChip] = useState('combined')
  const [instrMode, setInstrMode] = useState('fut')

  const tk = {
    nifty: dash?.positions?.find(p => p.underlying === 'NIFTY'),
    mid: dash?.positions?.find(p => p.underlying === 'MIDCPNIFTY'),
  }

  if (isError) return <div className="pg-strategies"><div className="shell"><div className="crumb">⚠ API error: {String(error?.message)}</div></div></div>
  if (!data) return <div className="pg-strategies"><div className="shell"><div className="title">Strategies</div><div className="crumb">Loading…</div></div></div>

  const s = data.summary
  const pairMaxDd = Number(s.pair_max_dd_pct ?? s.max_dd_pct ?? 0)
  const monthly = data.monthly
  const presetDates = getDashboardPresetDates(monthly, range === 'Custom' ? 'All' : range, dash?.latest_date)
  const startDate = customStartDate || presetDates.start
  const endDate = customEndDate || presetDates.end
  const minDate = firstMonthlyDate(monthly)
  const maxDate = lastMonthlyDate(monthly, dash?.latest_date)
  const selectedMonthly = range === 'Custom'
    ? selectDashboardDateRange(monthly, startDate, endDate)
    : selectDashboardRange(monthly, range)
  const strategyStats = buildDashboardRangeStats(selectedMonthly, s.base_aum_cr ?? 30)
  const curveMonthly = strategyStats.monthly
  const chartDomain = equityDomain(startDate, endDate, curveMonthly)
  const liveRows = curveMonthly.map(row => ({ date: row.month, value: Number(row.cumulative_inr) || 0 }))
  const backtestRows = buildBacktestRows(dash?.backtest?.series, chartDomain, dash?.backtest?.base_aum_cr ?? 30)
  const valueDomain = equityValueDomain(liveRows, [])
  const cur = buildDateCurvePath(liveRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const backtestPath = buildDateCurvePath(backtestRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const curPts = dateLinePoints(liveRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const backtestPts = dateLinePoints(backtestRows, chartDomain, valueDomain, EQ_W, EQ_H, EQ_PAD)
  const timeline = timelineTicks(chartDomain, curveMonthly)
  const spark = buildCurvePath(curveMonthly, 700, 54, 4)
  const pcts = curveMonthly.map(m => m.pct)
  const bestMo = Math.max(...pcts), worstMo = Math.min(...pcts)
  const rangeTrades = curveMonthly.reduce((sum, m) => sum + (Number(m.trades) || 0), 0)
  const rangeGrossInr = curveMonthly.reduce((sum, m) => sum + (Number(m.gross_inr) || 0), 0)
  const grossRet = s.aum_cr ? +(rangeGrossInr / 1e7 / s.aum_cr * 100).toFixed(1) : 0
  const drawdownSeries = buildCapitalDrawdownSeries(curveMonthly, s.aum_cr)
  const rollingSharpe12 = rollingSharpe(curveMonthly, s.aum_cr, 12)
  const riskMetrics = extendedRiskMetrics(curveMonthly, s.aum_cr)
  const worstDrawdownRows = worstDrawdowns(curveMonthly, s.aum_cr, 5)
  const quantileRows = returnQuantiles(curveMonthly, s.aum_cr)
  const yearRows = yearlyReturns(monthly, s.base_aum_cr ?? 30)
  const legSummary = buildLegSummary(curveMonthly, s.aum_cr)
  const legYearRows = buildLegYearRows(monthly, yearRows)

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
    <div className="pg-strategies">
      <div className="subbar"><div className="in">
        <Ticker name="NIFTY 50" p={tk.nifty} />
        <Ticker name="MIDCAP SELECT" p={tk.mid} />
        <div className="ti"><span className="n">Data as of</span><span className="v">{dash?.latest_date || '—'}</span></div>
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
        <div className="pagehd fu">
          <div><div className="title">Strategies</div><div className="crumb" style={{ marginBottom: 0 }}>1 active · compare &amp; analyse</div></div>
          <div className="controls" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div className="chips">
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 4 }}>Index</span>
              <button className={'chip' + (indexChip === 'combined' ? ' on' : '')} onClick={() => setIndexChip('combined')}>Combined</button>
              <button className={'chip' + (indexChip === 'nifty' ? ' on' : '')} onClick={() => setIndexChip('nifty')}>NIFTY 50</button>
              <button className={'chip' + (indexChip === 'midcap' ? ' on' : '')} onClick={() => setIndexChip('midcap')}>NIFTY MID SELECT</button>
              <button className={'chip' + (indexChip === 'banknifty' ? ' on' : '')} onClick={() => setIndexChip('banknifty')}>BANK NIFTY</button>
            </div>
            <div className="chips">
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 4 }}>Instrument</span>
              <button className={'chip' + (instrMode === 'fut' ? ' on' : '')} onClick={() => setInstrMode('fut')}>Fut</button>
              <button className={'chip' + (instrMode === 'opt' ? ' on' : '')} onClick={() => setInstrMode('opt')}>Options</button>
            </div>
          </div>
        </div>

        {/* strategy cards */}
        <div className="scards fu" style={{ animationDelay: '.04s' }}>
          <div className="panel scard">
            <div className="hd">
              <div><div className="nm">{s.name}</div><div className="st">{s.subtitle}</div></div>
              <span className="badge act">● Active</span>
            </div>
            <div className="statrow">
              <Sc l="Net PnL" cls={uD(strategyStats.total_net_inr)} v={fCr(strategyStats.total_net_inr / 1e7)} />
              <Sc l="Return" cls={uD(strategyStats.return_pct)} v={pctS(strategyStats.return_pct)} />
              <Sc l="Trades" v={rangeTrades} />
              <Sc l="Win %" v={strategyStats.win_rate + '%'} />
              <Sc l="Sharpe" v={strategyStats.sharpe} />
              <Sc l="Max DD" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
              <Sc l="CAGR" cls="u" v={'~' + s.cagr_pct + '%'} />
            </div>
            <div className="spark">
              <svg viewBox="0 0 700 54" preserveAspectRatio="none">
                <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0EA5E9" stopOpacity=".22" /><stop offset="1" stopColor="#0EA5E9" stopOpacity="0" /></linearGradient></defs>
                <path d={spark.fill} fill="url(#sg)" />
                <path d={spark.line} fill="none" stroke="#0EA5E9" strokeWidth="2.2" />
              </svg>
              <div className="legend"><span><i style={{ background: '#0EA5E9' }}></i>Cumulative Net PnL</span></div>
            </div>
          </div>

          <div className="panel scard ghost">
            <div className="hd"><div><div className="nm">Index Momentum</div><div className="st">Trend-follow · index futures</div></div><span className="badge soon">Coming soon</span></div>
            <div className="ghbody"><div className="big">◴</div><div style={{ fontSize: 12, fontWeight: 700 }}>In research</div><div style={{ fontSize: 11 }}>Backtest underway · target H2 FY27</div></div>
          </div>
          <div className="panel scard ghost">
            <div className="hd"><div><div className="nm">Vol Carry</div><div className="st">Options · short-vol overlay</div></div><span className="badge soon">Coming soon</span></div>
            <div className="ghbody"><div className="big">◴</div><div style={{ fontSize: 12, fontWeight: 700 }}>In research</div><div style={{ fontSize: 11 }}>Concept stage · not deployed</div></div>
          </div>
        </div>

        {/* variant pending banner — shown when BankNifty or Options selected (uses combined data as stand-in) */}
        {(indexChip === 'banknifty' || instrMode === 'opt') && (
          <div style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 8, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{indexChip === 'banknifty' ? 'BankNifty Variant' : 'Options Variant'}</span>
            <span style={{ color: 'var(--muted)' }}>Tradesheet pending · showing Combined Pair Trading data as preview — variant-specific stats will update once the sheet is uploaded.</span>
          </div>
        )}

        {/* detail bento */}
        <div className="bento fu" style={{ animationDelay: '.08s' }}>
          {/* equity curve */}
          <div className="panel c8 flexcol" style={{ padding: '16px 18px' }}>
            <div className="t-l" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <b style={{ fontFamily: "'Familjen Grotesk'", fontWeight: 700, fontSize: 16, marginRight: 'auto' }}>Pair Trading — Equity Curve</b>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>cumulative net PnL · monthly EOD</span>
              <button className={'bt-toggle ' + (showBacktest ? 'on' : '')} onClick={() => setShowBacktest(v => !v)}>
                <span></span>Backtest
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 12 }}>
              <div className={'m ' + uD(strategyStats.total_net_inr)} style={{ fontSize: 26, fontWeight: 600 }}>{fCr(strategyStats.total_net_inr / 1e7)} <span style={{ fontSize: 14 }}>/ {pctS(strategyStats.return_pct)}</span></div>
              <div className="pills">
                <div className="pill"><div className="l">Best mo</div><div className="v u">{pctS(Number.isFinite(bestMo) ? bestMo : 0)}</div></div>
                <div className="pill"><div className="l">Worst mo</div><div className="v d">{pctS(Number.isFinite(worstMo) ? worstMo : 0)}</div></div>
                <div className="pill"><div className="l">CAGR</div><div className="v u">~{s.cagr_pct}%</div></div>
              </div>
            </div>
            <div style={{ marginTop: 14, flex: 1, display: 'flex', alignItems: 'flex-end' }}>
              <div className="qa-chart wide">
                <svg viewBox={`0 0 ${EQ_W} ${EQ_H}`} preserveAspectRatio="none" style={{ width: '100%', height: EQ_H, display: 'block' }}>
                  <defs><linearGradient id="eg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0EA5E9" stopOpacity=".2" /><stop offset="1" stopColor="#0EA5E9" stopOpacity="0" /></linearGradient></defs>
                  <g stroke="#F3EADD" strokeWidth="1"><line x1="0" y1="38" x2="760" y2="38" /><line x1="0" y1="75" x2="760" y2="75" /><line x1="0" y1="112" x2="760" y2="112" /></g>
                  {showBacktest && backtestRows.length > 0 && (
                    <g className="backtest-line">
                      <path d={backtestPath.line} fill="none" stroke="#F97316" strokeWidth="2.1" strokeDasharray="5 4" />
                    </g>
                  )}
                  <path d={cur.fill} fill="url(#eg2)" />
                  <path d={cur.line} fill="none" stroke="#0EA5E9" strokeWidth="2.6" />
                  {equityTip && curPts[equityTip.index] && (
                    <g className="qa-hover-line">
                      <line x1={curPts[equityTip.index].x} y1={EQ_PAD} x2={curPts[equityTip.index].x} y2={EQ_H - EQ_PAD} stroke="#075985" strokeWidth="1" strokeDasharray="3 4" />
                      <circle cx={curPts[equityTip.index].x} cy={curPts[equityTip.index].y} r="4.5" fill="#0EA5E9" stroke="#fff" strokeWidth="2" />
                    </g>
                  )}
                  <rect
                    className="qa-hit"
                    x="0"
                    y="0"
                    width={EQ_W}
                    height={EQ_H}
                    onMouseMove={event => setEquityTip(nearestPointTip(event, curPts, EQ_W, EQ_H, showBacktest ? backtestPts : []))}
                    onMouseLeave={() => setEquityTip(null)}
                  />
                </svg>
                {equityTip && curveMonthly[equityTip.index] && (
                  <div className="qa-tip" style={{ left: `${equityTip.xPct}%`, top: `${equityTip.yPct}%` }}>
                    <span>{monthShort(curveMonthly[equityTip.index].month)}</span>
                    <b>{fCr(curveMonthly[equityTip.index].cumulative_inr / 1e7)}</b>
                    {showBacktest && equityTip.backtestIndex != null && backtestRows[equityTip.backtestIndex] && (
                      <em>Backtest {fCr(backtestRows[equityTip.backtestIndex].value / 1e7)}</em>
                    )}
                  </div>
                )}
                <div className="equity-timeline" aria-label="Equity curve timeline">
                  {timeline.map(tick => (
                    <span className="timeline-tick" key={tick.key} style={{ left: `${tick.xPct}%` }}>{tick.label}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="legend">
              <span><i style={{ background: '#0EA5E9' }}></i>Cumulative Net PnL (realised)</span>
              {showBacktest && <span><i style={{ background: '#F97316' }}></i>Spot backtest</span>}
            </div>
          </div>

          {/* stats grid */}
          <div className="panel c4 flexcol">
            <div className="sechd">Strategy stats <span className="meta">since {s.since}</span></div>
            <div className="statgrid" style={{ paddingTop: 0, flex: 1 }}>
              <Sg l="Gross PnL" cls={uD(rangeGrossInr)} v={fCr(rangeGrossInr / 1e7)} small={(grossRet >= 0 ? '+' : '') + grossRet + '%'} />
              <Sg l="Net PnL" cls={uD(strategyStats.total_net_inr)} v={fCr(strategyStats.total_net_inr / 1e7)} small={pctS(strategyStats.return_pct)} />
              <Sg l="Win rate" v={strategyStats.win_rate + '%'} small={`${curveMonthly.filter(m => m.net_inr > 0).length}/${curveMonthly.length} mo`} />
              <Sg l="Sharpe" v={strategyStats.sharpe} />
              <Sg l="Max drawdown" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
              <Sg l="Exposure" v={`₹${s.exposure_cr.toFixed(1)} Cr`} />
            </div>
          </div>

          {/* MoM heatmap + table */}
          <div className="panel c7 flexcol">
            <div className="sechd">Month-on-Month Net % <span className="meta">net return · % of AUM</span></div>
            <div style={{ padding: '0 16px' }}>
              <Heatmap monthly={curveMonthly} />
              <div className="hmx"><span></span>{['J','F','M','A','M','J','J','A','S','O','N','D'].map((m, i) => <span key={i}>{m}</span>)}</div>
            </div>
            <div className="tscroll" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Month</th><th className="num">Net %</th></tr></thead>
                <tbody>
                  {[...curveMonthly].reverse().map(m => (
                    <tr key={m.month}>
                      <td>{monthLabel(m.month)}</td>
                      <td className={'num m ' + uD(m.pct)}>{pctS(m.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* YoY table */}
          <div className="panel c5 flexcol">
            <div className="sechd">Year-on-Year <span className="meta">PnL in ₹ &amp; %</span></div>
            <div className="tscroll" style={{ marginTop: 4 }}>
              <table>
                <thead><tr><th>Year</th><th className="num">Midcap P/L</th><th className="num">NIFTY P/L</th><th className="num">Max DD %</th><th className="num">Sharpe</th></tr></thead>
                <tbody>
                  {legYearRows.map((y, i) => (
                    <tr key={y.year}>
                      <td>{y.year}{i === data.yearly.length - 1 ? ' YTD' : ''}</td>
                      <td className={'num m ' + uD(y.midcap_net_inr)}>{fCr(y.midcap_net_inr / 1e7)}</td>
                      <td className={'num m ' + uD(y.nifty_net_inr)}>{fCr(y.nifty_net_inr / 1e7)}</td>
                      <td className="num m d">−{y.max_dd_pct}%</td>
                      <td className="num m">{y.sharpe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note-inline" style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '0 16px 14px', marginTop: 'auto' }}>
                  Total: {s.trades} trades · {fCr(s.net_cr)} · {pctS(s.return_pct)} · single client · ₹{s.aum_cr.toFixed(0)} Cr AUM.
            </div>
          </div>
        </div>

        <div className="detail-action-row fu" style={{ animationDelay: '.1s' }}>
          <button className={'chip detail-toggle ' + (showDetailedStats ? 'on' : '')} onClick={() => setShowDetailedStats(v => !v)}>Detailed Stats</button>
        </div>

        {showDetailedStats && (
          <div className="analytics-grid fu" style={{ animationDelay: '.12s' }}>
            <div className="panel qa-card">
              <div className="qa-head"><b>Underwater / Drawdown</b><span>equity from capital base</span></div>
              <UnderwaterChart data={drawdownSeries} />
            </div>
            <div className="panel qa-card">
              <div className="qa-head"><b>Rolling 12M Sharpe</b><span>monthly returns · annualized</span></div>
              <RollingSharpeChart data={rollingSharpe12} />
            </div>
            <div className="panel qa-card qa-card-wide">
              <div className="qa-head"><b>Extended Risk Metrics</b><span>selected range</span></div>
              <RiskMetricMatrix metrics={riskMetrics} />
            </div>
            <div className="panel qa-card qa-card-wide">
              <div className="qa-head"><b>Worst-5 Drawdown Periods</b><span>equity curve · shaded drawdown windows</span></div>
              <WorstDrawdownsPanel rows={worstDrawdownRows} series={drawdownSeries} />
            </div>
            <div className="panel qa-card qa-card-wide">
              <div className="qa-head"><b>Return Quantiles</b><span>monthly marks aggregated to quarter/year</span></div>
              <ReturnQuantilesChart rows={quantileRows} />
            </div>
          </div>
        )}

        {/* compare */}
        <div className="panel cmp fu" style={{ marginTop: 14, animationDelay: '.12s' }}>
          <div className="sechd">Compare strategies <span className="meta">Pair Trading vs pipeline</span></div>
          <div className="tscroll" style={{ marginTop: 2 }}>
            <table>
              <thead><tr><th>Metric</th><th className="num hl">Pair Trading <span className="tag">Active</span></th><th className="num">Index Momentum</th><th className="num">Vol Carry</th></tr></thead>
              <tbody>
                <Cmp l="Net PnL" cls={uD(strategyStats.total_net_inr)} v={fCr(strategyStats.total_net_inr / 1e7)} />
                <Cmp l="Return %" cls={uD(strategyStats.return_pct)} v={pctS(strategyStats.return_pct)} />
                <Cmp l="Midcap P/L" cls={uD(legSummary.midcap.net_inr)} v={fCr(legSummary.midcap.net_inr / 1e7)} />
                <Cmp l="Midcap P/L %" cls={uD(legSummary.midcap.pct)} v={pctS(legSummary.midcap.pct)} />
                <Cmp l="NIFTY P/L" cls={uD(legSummary.nifty.net_inr)} v={fCr(legSummary.nifty.net_inr / 1e7)} />
                <Cmp l="NIFTY P/L %" cls={uD(legSummary.nifty.pct)} v={pctS(legSummary.nifty.pct)} />
                <Cmp l="Combined P/L" cls={uD(legSummary.combined.net_inr)} v={fCr(legSummary.combined.net_inr / 1e7)} />
                <Cmp l="Combined P/L %" cls={uD(legSummary.combined.pct)} v={pctS(legSummary.combined.pct)} />
                <Cmp l="Trades" v={rangeTrades} />
                <Cmp l="Win %" v={strategyStats.win_rate + '%'} />
                <Cmp l="Sharpe" v={strategyStats.sharpe} />
                <Cmp l="Max DD" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
                <Cmp l="CAGR" cls="u" v={'~' + riskMetrics.cagr_pct + '%'} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="note">Strategies · live data · 1 active strategy · Index Momentum &amp; Vol Carry in research</div>
    </div>
  )
}

function Ticker({ name, p }) {
  const up = p ? p.points >= 0 : true
  return <div className="ti"><span className="n">{name}</span><span className="v">{p ? fmtNum(p.ltp) : '—'}</span>
    {p && <span className={'c ' + (up ? 'u' : 'd')}>{(up ? '▲' : '▼') + Math.abs(p.points).toFixed(2)}</span>}</div>
}
const Sc = ({ l, v, cls }) => <div className="sc"><div className="l">{l}</div><div className={'v ' + (cls || '')}>{v}</div></div>
const Sg = ({ l, v, cls, small }) => <div className="sg"><div className="l">{l}</div><div className={'v ' + (cls || '')}>{v}{small && <small>{small}</small>}</div></div>
const Cmp = ({ l, v, cls }) => (
  <tr><td className="nmcol">{l}</td>
    <td className={'num hl ' + (cls || '')}>{v}</td>
    <td className="num m" style={{ color: 'var(--muted)' }}>—</td>
    <td className="num m" style={{ color: 'var(--muted)' }}>—</td></tr>
)

function buildLegSummary(rows, aumCr) {
  const aumInr = Number(aumCr) * 1e7
  const midcap = (rows || []).reduce((sum, row) => sum + (Number(row.midcap_net_inr) || 0), 0)
  const nifty = (rows || []).reduce((sum, row) => sum + (Number(row.nifty_net_inr) || 0), 0)
  const combined = (rows || []).reduce((sum, row) => sum + (Number(row.net_inr) || 0), 0)
  const pct = value => aumInr ? +(value / aumInr * 100).toFixed(2) : 0
  return {
    midcap: { net_inr: midcap, pct: pct(midcap) },
    nifty: { net_inr: nifty, pct: pct(nifty) },
    combined: { net_inr: combined, pct: pct(combined) },
  }
}

function buildLegYearRows(rows, combinedYears) {
  const map = new Map()
  ;(rows || []).forEach(row => {
    const year = String(row.month || '').slice(0, 4)
    if (!map.has(year)) map.set(year, { midcap_net_inr: 0, nifty_net_inr: 0 })
    const target = map.get(year)
    target.midcap_net_inr += Number(row.midcap_net_inr) || 0
    target.nifty_net_inr += Number(row.nifty_net_inr) || 0
  })
  return (combinedYears || []).map(row => ({
    ...row,
    midcap_net_inr: Math.round(map.get(row.year)?.midcap_net_inr || 0),
    nifty_net_inr: Math.round(map.get(row.year)?.nifty_net_inr || 0),
  }))
}

function Heatmap({ monthly }) {
  const map = {}
  monthly.forEach(m => { const d = new Date(m.month + 'T00:00:00'); map[`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`] = m.pct })
  const years = [...new Set(monthly.map(m => m.month.slice(0, 4)))].sort()
  return (
    <div className="hm">
      {years.flatMap(y => {
        const cells = [<div key={y + 'yl'} className="yl">{"'" + y.slice(2)}</div>]
        for (let mo = 1; mo <= 12; mo++) {
          const key = `${y}-${mo}`
          const pct = key in map ? map[key] : null
          const lbl = pct === null ? '' : (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(2) + '%'
          cells.push(<div key={key} className="cell" style={{ background: hmColor(pct), color: hmText(pct) }}
            title={`${y}-${mo < 10 ? '0' : ''}${mo}: ${pct === null ? 'No data' : (pct >= 0 ? '+' : '') + pct.toFixed(3) + '%'}`}>{lbl}</div>)
        }
        return cells
      })}
    </div>
  )
}

function chartPoint(index, total, value, min, max, width, height, pad) {
  const x = total <= 1 ? width / 2 : pad + index * (width - pad * 2) / (total - 1)
  const range = max - min || 1
  const y = height - pad - (value - min) / range * (height - pad * 2)
  return { x, y }
}

function nearestPointTip(event, pts, width, height, overlayPts = []) {
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

function UnderwaterChart({ data }) {
  const [tip, setTip] = useState(null)
  const W = 760, H = 150, pad = 14
  if (!data.length) return <div className="qa-empty">No drawdown data.</div>
  const min = Math.min(...data.map(d => d.drawdown_pct), 0)
  const pts = data.map((d, i) => chartPoint(i, data.length, d.drawdown_pct, min, 0, W, H, pad))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const fill = `${line} L${pts[pts.length - 1].x.toFixed(1)},${pad} L${pts[0].x.toFixed(1)},${pad} Z`
  const worst = Math.abs(min).toFixed(2)
  const active = tip ? data[tip.index] : null
  return (
    <div>
      <div className="qa-chart">
        <svg className="qa-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line x1="0" y1={pad} x2={W} y2={pad} stroke="#E7D6C0" strokeWidth="1" />
          <line x1="0" y1={H - pad} x2={W} y2={H - pad} stroke="#F3EADD" strokeWidth="1" />
          <path d={fill} fill="rgba(194,65,12,.14)" />
          <path d={line} fill="none" stroke="#C2410C" strokeWidth="2.2" strokeLinejoin="round" />
          {tip && (
            <g className="qa-hover-line">
              <line x1={pts[tip.index].x} y1={pad} x2={pts[tip.index].x} y2={H - pad} stroke="#8B5E34" strokeWidth="1" strokeDasharray="3 4" />
              <circle cx={pts[tip.index].x} cy={pts[tip.index].y} r="4.5" fill="#C2410C" stroke="#fff" strokeWidth="2" />
            </g>
          )}
          <rect
            className="qa-hit"
            x="0"
            y="0"
            width={W}
            height={H}
            onMouseMove={event => setTip(nearestPointTip(event, pts, W, H))}
            onMouseLeave={() => setTip(null)}
          />
        </svg>
        {tip && active && (
          <div className="qa-tip" style={{ left: `${tip.xPct}%`, top: `${tip.yPct}%` }}>
            <span>{monthShort(active.month)}</span>
            <b>Drawdown {active.drawdown_pct.toFixed(2)}%</b>
          </div>
        )}
      </div>
      <div className="qa-foot"><span>0%</span><b className="d">Worst -{worst}%</b></div>
    </div>
  )
}

function RollingSharpeChart({ data }) {
  const [tip, setTip] = useState(null)
  const W = 760, H = 150, pad = 14
  if (!data.length) return <div className="qa-empty">Need 12 monthly observations for rolling Sharpe.</div>
  const values = data.map(d => d.sharpe)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const zero = chartPoint(0, 1, 0, min, max, W, H, pad).y
  const pts = data.map((d, i) => chartPoint(i, data.length, d.sharpe, min, max, W, H, pad))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const active = tip ? data[tip.index] : null
  return (
    <div>
      <div className="qa-chart">
        <svg className="qa-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line x1="0" y1={zero} x2={W} y2={zero} stroke="#E7D6C0" strokeWidth="1" strokeDasharray="4 4" />
          <path d={line} fill="none" stroke="#0EA5E9" strokeWidth="2.4" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle key={data[i].month} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="3.5" fill="#0EA5E9" />
          ))}
          {tip && (
            <g className="qa-hover-line">
              <line x1={pts[tip.index].x} y1={pad} x2={pts[tip.index].x} y2={H - pad} stroke="#075985" strokeWidth="1" strokeDasharray="3 4" />
              <circle cx={pts[tip.index].x} cy={pts[tip.index].y} r="4.5" fill="#0EA5E9" stroke="#fff" strokeWidth="2" />
            </g>
          )}
          <rect
            className="qa-hit"
            x="0"
            y="0"
            width={W}
            height={H}
            onMouseMove={event => setTip(nearestPointTip(event, pts, W, H))}
            onMouseLeave={() => setTip(null)}
          />
        </svg>
        {tip && active && (
          <div className="qa-tip" style={{ left: `${tip.xPct}%`, top: `${tip.yPct}%` }}>
            <span>{monthShort(active.month)}</span>
            <b>Sharpe {active.sharpe.toFixed(2)}</b>
          </div>
        )}
      </div>
      <div className="qa-foot"><span>{data[0].month.slice(0, 7)}</span><b>{data[data.length - 1].sharpe.toFixed(2)}</b></div>
    </div>
  )
}

function WorstDrawdownsPanel({ rows, series }) {
  const [tip, setTip] = useState(null)
  if (!rows.length) return <div className="qa-empty">No drawdown periods in this range.</div>
  const W = 900, H = 220, pad = 18
  const data = series || []
  if (!data.length) return <div className="qa-empty">No equity curve data.</div>
  const lastMonth = series?.[series.length - 1]?.month || ''
  const periods = rows.map(row => ({ ...row, endMonth: row.recovered || lastMonth || row.trough }))
  const values = data.map(point => point.cumulative_inr || 0)
  const min = Math.min(0, ...values)
  const max = Math.max(...values, 1)
  const pts = data.map((point, idx) => chartPoint(idx, data.length, point.cumulative_inr || 0, min, max, W, H, pad))
  const line = pts.map((point, idx) => `${idx ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const zeroY = chartPoint(0, 1, 0, min, max, W, H, pad).y
  const xForIndex = idx => data.length <= 1 ? W / 2 : pad + idx * (W - pad * 2) / (data.length - 1)
  const monthIndex = month => Math.max(0, data.findIndex(point => point.month === month))
  const active = tip ? data[tip.index] : null
  const activePeriod = active ? periods.find(period => active.month >= period.started && active.month <= period.endMonth) : null

  return (
    <div className="dd-period-panel">
      <div className="dd-period-chart">
        <svg className="qa-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <g stroke="#E8E2D8" strokeWidth="1">
            <line x1="0" y1={pad} x2={W} y2={pad} />
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} />
            <line x1="0" y1={H - pad} x2={W} y2={H - pad} />
          </g>
          <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#1F1B16" strokeWidth="1.2" strokeDasharray="5 4" opacity=".55" />
          {periods.map(period => {
            const startIdx = monthIndex(period.started)
            const endIdx = monthIndex(period.endMonth)
            const x = xForIndex(startIdx)
            const width = Math.max(6, xForIndex(Math.max(endIdx, startIdx)) - x)
            return (
              <rect key={`${period.started}-${period.trough}`} x={x.toFixed(1)} y={pad} width={width.toFixed(1)} height={H - pad * 2}
                fill="#FCA5A5" opacity=".28">
                <title>{`${drawdownDate(period.started)} to ${drawdownDate(period.recovered)} · ${period.drawdown_pct.toFixed(2)}% · ${period.days} days`}</title>
              </rect>
            )
          })}
          <path d={line} fill="none" stroke="#0EA5E9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {tip && (
            <g className="qa-hover-line">
              <line x1={pts[tip.index].x} y1={pad} x2={pts[tip.index].x} y2={H - pad} stroke="#075985" strokeWidth="1" strokeDasharray="3 4" />
              <circle cx={pts[tip.index].x} cy={pts[tip.index].y} r="4.5" fill="#0EA5E9" stroke="#fff" strokeWidth="2" />
            </g>
          )}
          <rect
            className="qa-hit"
            x="0"
            y="0"
            width={W}
            height={H}
            onMouseMove={event => setTip(nearestPointTip(event, pts, W, H))}
            onMouseLeave={() => setTip(null)}
          />
        </svg>
        {tip && active && (
          <div className="qa-tip" style={{ left: `${tip.xPct}%`, top: `${tip.yPct}%` }}>
            <span>{monthShort(active.month)}</span>
            <b>{fCr((active.cumulative_inr || 0) / 1e7)}</b>
            {activePeriod && <em>DD {activePeriod.drawdown_pct.toFixed(2)}% · {activePeriod.days} days</em>}
          </div>
        )}
        <div className="dd-axis"><span>{fCr(min / 1e7)}</span><b>{fCr(max / 1e7)}</b></div>
      </div>
      <div className="dd-period-legend">
        <span><i style={{ background: '#0EA5E9' }}></i>Cumulative Net PnL</span>
        <span><i style={{ background: '#FCA5A5' }}></i>Worst drawdown windows</span>
      </div>
      <div className="tscroll qa-table">
        <table>
          <thead><tr><th>Started</th><th>Trough</th><th>Recovered</th><th className="num">Drawdown</th><th className="num">Days</th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={`${row.started}-${row.trough}`}>
                <td>{drawdownDate(row.started)}</td>
                <td>{drawdownDate(row.trough)}</td>
                <td>{drawdownDate(row.recovered)}</td>
                <td className="num m d">{row.drawdown_pct.toFixed(2)}%</td>
                <td className="num m">{row.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReturnQuantilesChart({ rows }) {
  const [tip, setTip] = useState(null)
  if (!rows.length) return <div className="qa-empty">No return quantile data.</div>
  const W = 900, H = 240, padX = 54, padY = 24
  const values = rows.flatMap(row => [row.min, row.q1, row.median, row.q3, row.max, ...row.outliers])
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 1)
  const yFor = value => H - padY - (value - min) / (max - min || 1) * (H - padY * 2)
  const xStep = (W - padX * 2) / rows.length
  const boxW = Math.min(86, xStep * .46)
  const colors = ['#0EA5E9', '#B4536F', '#10B981', '#8B5CF6', '#F97316']
  const ticks = [min, min + (max - min) / 2, max]

  return (
    <div className="quant-chart">
      <svg className="qa-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {ticks.map(value => (
          <g key={value}>
            <line x1={padX} y1={yFor(value)} x2={W - padX} y2={yFor(value)} stroke="#E8E2D8" strokeWidth="1" />
            <text x={padX - 12} y={yFor(value) + 4} textAnchor="end" className="quant-y">{value.toFixed(0)}%</text>
          </g>
        ))}
        <line x1={padX} y1={yFor(0)} x2={W - padX} y2={yFor(0)} stroke="#CDBFA9" strokeWidth="1" />
        {rows.map((row, idx) => {
          const x = padX + xStep * idx + xStep / 2
          const color = colors[idx % colors.length]
          const top = yFor(row.q3)
          const bottom = yFor(row.q1)
          return (
            <g key={row.label}>
              <line x1={x} y1={yFor(row.min)} x2={x} y2={yFor(row.max)} stroke="#494949" strokeWidth="1.3" />
              <line x1={x - boxW * .36} y1={yFor(row.min)} x2={x + boxW * .36} y2={yFor(row.min)} stroke="#494949" strokeWidth="1.3" />
              <line x1={x - boxW * .36} y1={yFor(row.max)} x2={x + boxW * .36} y2={yFor(row.max)} stroke="#494949" strokeWidth="1.3" />
              <rect x={x - boxW / 2} y={top} width={boxW} height={Math.max(5, bottom - top)} fill={color} opacity=".72" stroke="#494949" strokeWidth="1" />
              <line x1={x - boxW / 2} y1={yFor(row.median)} x2={x + boxW / 2} y2={yFor(row.median)} stroke="#1F1B16" strokeWidth="1.5" />
              {row.outliers.map((value, pointIdx) => (
                <circle key={`${row.label}-${pointIdx}`} cx={x + ((pointIdx % 2) ? 5 : -5)} cy={yFor(value)} r="3.2" fill="#fff" stroke="#494949" strokeWidth="1" />
              ))}
              <rect
                className="qa-hit"
                x={x - xStep / 2}
                y="0"
                width={xStep}
                height={H}
                onMouseMove={event => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setTip({ row, xPct: (x / W) * 100, yPct: ((event.clientY - rect.top) / rect.height) * 100 })
                }}
                onMouseLeave={() => setTip(null)}
              />
              <text x={x} y={H - 4} textAnchor="middle" className="quant-label">{row.label}</text>
            </g>
          )})}
        </svg>
      {tip && (
        <div className="qa-tip" style={{ left: `${tip.xPct}%`, top: `${tip.yPct}%` }}>
          <span>{tip.row.label}</span>
          <b>Median {tip.row.median.toFixed(2)}%</b>
          <em>Q1 {tip.row.q1.toFixed(2)}% · Q3 {tip.row.q3.toFixed(2)}%</em>
          <em>Range {tip.row.min.toFixed(2)}% to {tip.row.max.toFixed(2)}%</em>
        </div>
      )}
      </div>
  )
}

function drawdownDate(s) {
  if (!s) return 'Active'
  return monthShort(s)
}

function RiskMetricMatrix({ metrics }) {
  const [tip, setTip] = useState(null)
  const rows = [
    { label: 'Sortino', value: metrics.sortino.toFixed(2), tip: 'Like Sharpe, but it only punishes bad monthly moves. Higher means returns were better compared with downside risk.' },
    { label: 'Calmar', value: metrics.calmar.toFixed(2), tip: 'Compares annual growth with the worst capital drawdown. Higher means growth was strong relative to the deepest fall.' },
    { label: 'Vol ann.', value: metrics.annual_vol_pct.toFixed(2) + '%', tip: 'Annualized volatility from monthly net returns. It shows how much the strategy value tends to move around.' },
    { label: 'Profit factor', value: metrics.profit_factor.toFixed(2), tip: 'Total winning months divided by total losing months. Above 1 means wins outweighed losses.' },
    { label: 'Payoff', value: metrics.payoff_ratio.toFixed(2), tip: 'Average winning amount compared with average losing amount. Higher means wins were larger than losses.' },
    { label: 'Recovery', value: metrics.recovery_factor.toFixed(2), tip: 'Total return compared with the worst drawdown. Higher means the strategy recovered more efficiently from pain.' },
    { label: 'Common Sense Ratio', value: metrics.common_sense_ratio.toFixed(2), tip: 'Combines profitability with tail behavior. Higher means gains outweighed losses and extreme upside was healthier than downside.' },
    { label: 'CPC Index', value: metrics.cpc_index.toFixed(2), tip: 'Blends profit factor, win rate, and win/loss size. It is a compact quality score for consistency plus payoff.' },
    { label: 'Tail Ratio', value: metrics.tail_ratio.toFixed(2), tip: 'Compares strong upside months with bad downside months. Higher means the best tail is better than the worst tail.' },
    { label: 'Win/Loss', value: metrics.win_loss_ratio.toFixed(2), tip: 'Average win size compared with average loss size. Same idea as payoff, shown in trading report language.' },
    { label: 'Gain/Pain', value: metrics.gain_pain_ratio.toFixed(2), tip: 'Total gains compared with total losses. Higher means the strategy earned more for each unit of loss.' },
    { label: 'Kelly', value: metrics.kelly_criterion_pct.toFixed(2) + '%', tip: 'Position-sizing guide from win rate and payoff. It estimates how aggressive the strategy could be before risk becomes too high.' },
    { label: 'Avg return', value: metrics.avg_return_pct.toFixed(2) + '%', tip: 'Average monthly net return in the selected range.' },
    { label: 'Avg win', value: metrics.avg_win_pct.toFixed(2) + '%', tip: 'Average return for months that finished positive.' },
    { label: 'Avg loss', value: metrics.avg_loss_pct.toFixed(2) + '%', tip: 'Average return for months that finished negative.' },
    { label: 'Skew', value: metrics.skew.toFixed(2), tip: 'Shows whether returns lean toward big upside or big downside. Positive is upside-leaning, negative is downside-leaning.' },
    { label: 'Kurtosis', value: metrics.kurtosis.toFixed(2), tip: 'Shows how fat the tails are. Higher means more unusual large moves compared with a normal return pattern.' },
  ]
  function showTip(event, text) {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 286
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12)
    const placeAbove = rect.bottom + 96 > window.innerHeight && rect.top > 120
    setTip({
      text,
      left,
      top: placeAbove ? rect.top - 6 : rect.bottom + 6,
      placeAbove,
    })
  }
  return (
    <>
      <div className="risk-matrix">
        {rows.map(row => (
          <div className="risk-cell" key={row.label}>
            <span>{row.label}
              <button className="risk-help" type="button" aria-label={`${row.label} explanation`}
                onMouseEnter={event => showTip(event, row.tip)}
                onFocus={event => showTip(event, row.tip)}
                onMouseLeave={() => setTip(null)}
                onBlur={() => setTip(null)}>?</button>
            </span>
            <b>{row.value}</b>
          </div>
        ))}
      </div>
      {tip && createPortal(
        <div className={'risk-help-tip ' + (tip.placeAbove ? 'above' : '')} style={{ left: tip.left, top: tip.top }}>
          {tip.text}
        </div>,
        document.body,
      )}
    </>
  )
}
