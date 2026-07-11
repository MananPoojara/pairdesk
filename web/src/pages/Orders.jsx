import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import DateRangeControl from '../components/DateRangeControl'
import { fmtNum } from '../lib/format'
import { getPresetDatesFromBounds } from '../lib/dashboardRange'
import './orders.css'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CAT_COLOR = { Institution: '#0EA5E9', HNI: '#F97316', Retail: '#10B981' }

function fDate(s) { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2) }
function fExpiry(s) { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()] }
function fL(inr) {
  const a = Math.abs(inr), sg = inr < 0 ? '−' : '+'
  if (a >= 1e7) return sg + '₹' + (a / 1e7).toFixed(2) + ' Cr'
  if (a >= 1e5) return sg + '₹' + (a / 1e5).toFixed(1) + ' L'
  if (a >= 1e3) return sg + '₹' + (a / 1e3).toFixed(1) + ' K'
  return sg + '₹' + Math.round(a).toLocaleString('en-IN')
}
const fCr = n => (n >= 0 ? '+' : '') + '₹' + Math.abs(n).toFixed(2) + ' Cr'

const Seg = ({ opts, val, on }) => (
  <div className="seg">{opts.map(o => (
    <button key={o.v} className={o.v === val ? 'on' : undefined} onClick={() => on(o.v)}>{o.label}</button>
  ))}</div>
)

export default function Orders() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['orders'], queryFn: () => apiGet('/api/orders') })
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })

  const [side, setSide] = useState('all')
  const [sym, setSym] = useState('all')
  const [regime, setRegime] = useState('all')
  const [mode, setMode] = useState('all')
  const [range, setRange] = useState('All')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [q, setQ] = useState('')
  const [client, setClient] = useState('all')
  const [expanded, setExpanded] = useState(null)

  const all = data?.trades || []
  // Unique clients that have orders (for the client filter), sorted by name.
  const clients = Array.from(
    new Map(all.map(t => [t.client_code, { code: t.client_code, name: t.client_name, category: t.category }])).values()
  ).sort((a, b) => a.name.localeCompare(b.name))
  const tradeDates = all.map(t => t.date).filter(Boolean).sort()
  const minDate = tradeDates[0] || ''
  const maxDate = tradeDates[tradeDates.length - 1] || ''
  const presetDates = getPresetDatesFromBounds(minDate, maxDate, range === 'Custom' ? 'All' : range)
  const startDate = customStartDate || presetDates.start
  const endDate = customEndDate || presetDates.end
  const trades = all.filter(t => {
    // Blotter is closed/settled trades (open positions live on the Dashboard).
    if (mode === 'open') return false
    if (client !== 'all' && t.client_code !== client) return false
    if (startDate && t.date < startDate) return false
    if (endDate && t.date > endDate) return false
    if (side !== 'all' && t.direction.toLowerCase() !== side) return false
    if (sym !== 'all' && t.underlying !== sym) return false
    if (regime !== 'all' && t.regime !== regime) return false
    const qq = q.toLowerCase()
    if (qq && !(t.underlying + t.contract + t.client_name + t.client_code).toLowerCase().includes(qq)) return false
    return true
  })

  let gross = 0, charges = 0, turnover = 0
  trades.forEach(t => { gross += t.gross_inr; charges += t.charges_inr; turnover += t.turnover_inr })
  const net = gross - charges

  // Combined P/L & % are pair-level (identical on both legs). Show them once per pair,
  // on the MIDCPNIFTY leg. A pair's two legs share an EXPIRY MONTH (not an entry date —
  // they roll on independent contract schedules), so key by client + expiry month.
  const pairKey = t => t.client_code + '|' + String(t.expiry || '').slice(0, 7)
  const pairAnchor = {}
  trades.forEach((t, i) => {
    const key = pairKey(t)
    if (!(key in pairAnchor)) pairAnchor[key] = i
    if (t.underlying === 'MIDCPNIFTY') pairAnchor[key] = i
  })

  const tk = {
    nifty: dash?.positions?.find(p => p.underlying === 'NIFTY')?.ltp,
    mid: dash?.positions?.find(p => p.underlying === 'MIDCPNIFTY')?.ltp,
    date: dash?.latest_date,
  }

  function exportCsv() {
    const hdr = ['Date','Client','Code','Category','Underlying','Contract','Expiry','Side','Regime','Lots','Qty','Entry','Exit','Points','Gross INR','Expense INR','Net INR','Combined P/L INR','Combined %','Turnover INR','STT','Exchange','SEBI','Stamp','GST'].join(',')
    const rows = trades.map(t => [t.date, `"${t.client_name}"`, t.client_code, t.category, t.underlying, t.contract, t.expiry, t.direction, t.regime, t.lots, t.qty, t.entry, t.exit, t.points, t.gross_inr, t.charges_inr, t.net_inr, t.combined_pl_inr, t.combined_pct, t.turnover_inr, t.stt_inr, t.exch_inr, t.sebi_inr, t.stamp_inr, t.gst_inr].join(','))
    const csv = hdr + '\n' + rows.join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = 'young-turtle-orders.csv'
    a.click()
  }

  const crumb = isError ? `API error: ${String(error?.message)}` : !data ? 'Loading…' :
    `${trades.length} trades · ₹${(turnover / 1e7).toFixed(2)} Cr turnover · net ${fCr(net / 1e7)} · ${startDate ? fDate(startDate) : '—'} – ${endDate ? fDate(endDate) : '—'}`

  function applyPreset(nextRange) {
    setRange(nextRange)
    setCustomStartDate('')
    setCustomEndDate('')
    setExpanded(null)
  }

  function applyStartDate(nextDate) {
    setCustomStartDate(nextDate)
    setCustomEndDate(cur => cur || endDate)
    setRange('Custom')
    setExpanded(null)
  }

  function applyEndDate(nextDate) {
    setCustomEndDate(nextDate)
    setCustomStartDate(cur => cur || startDate)
    setRange('Custom')
    setExpanded(null)
  }

  return (
    <div className="pg-orders">
      <div className="subbar"><div className="in">
        <div className="ti"><span className="n">NIFTY 50</span><span className="v">{tk.nifty ? fmtNum(tk.nifty) : '—'}</span></div>
        <div className="ti"><span className="n">MIDCAP SELECT</span><span className="v">{tk.mid ? fmtNum(tk.mid) : '—'}</span></div>
        <div className="ti"><span className="n">Data as of</span><span className="v">{tk.date || '—'}</span></div>
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
          <Seg val={mode} on={setMode} opts={[{ v: 'all', label: 'All Trades' }, { v: 'open', label: 'Open' }, { v: 'closed', label: 'Closed' }]} />
        </div>
      </div></div>

      <div className="shell fu">
        <div className="pagehd">
          <div><div className="title">Orders</div><div className="crumb">{crumb}</div></div>
          <div className="controls">
            <Seg val={side} on={v => { setSide(v); setExpanded(null) }} opts={[{ v: 'all', label: 'All' }, { v: 'long', label: 'Long' }, { v: 'short', label: 'Short' }]} />
            <Seg val={sym} on={v => { setSym(v); setExpanded(null) }} opts={[{ v: 'all', label: 'Both' }, { v: 'NIFTY', label: 'Nifty' }, { v: 'MIDCPNIFTY', label: 'Midcap' }]} />
            <button className="btn ghost" onClick={exportCsv}>⤓ Export CSV</button>
          </div>
        </div>

        <div className="kribbon fu" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
          <div className="kr"><div className="l">Total Trades</div><div className="v">{trades.length}</div><div className="s">{trades.length} trades shown</div></div>
          <div className="kr hlb"><div className="l">Gross PnL</div><div className={'v ' + (gross >= 0 ? 'u' : 'd')}>{fL(gross)}</div><div className="s">before expenses</div></div>
          <div className="kr"><div className="l">Total Turnover</div><div className="v">₹{(turnover / 1e7).toFixed(1)} Cr</div><div className="s">entry + exit value</div></div>
          <div className="kr"><div className="l">Total Expense</div><div className="v d">₹{(charges / 1e7).toFixed(2)} Cr</div><div className="s">Brokerage + Taxes</div></div>
          <div className="kr hl"><div className="l">Net PnL</div><div className={'v ' + (net >= 0 ? 'u' : 'd')}>{fL(net)}</div><div className="s">after all costs</div></div>
        </div>

        <div className="filterrow fu">
          <select className="client-sel" value={client} onChange={e => { setClient(e.target.value); setExpanded(null) }}>
            <option value="all">All clients ({clients.length})</option>
            {clients.map(c => <option key={c.code} value={c.code}>{c.name} · {c.category}</option>)}
          </select>
          <input className="srch-inp" placeholder="⌕ Search by symbol, client, contract…" value={q} onChange={e => { setQ(e.target.value); setExpanded(null) }} />
          <Seg val={regime} on={v => { setRegime(v); setExpanded(null) }} opts={[{ v: 'all', label: 'All regimes' }, { v: 'BULL', label: 'Bull' }, { v: 'BEAR', label: 'Bear' }]} />
        </div>

        <div className="blotter fu">
          <div className="pth"><b>Trade List</b><span className="crumb" style={{ margin: 0 }}>{trades.length} trades</span></div>
          <div className="tscroll">
            <table>
              <thead><tr>
                <th>Date</th><th>Client</th><th>Symbol</th><th>Expiry</th><th>Side</th><th>Regime</th>
                <th className="num">Lots</th><th className="num">Qty</th><th className="num">Entry</th><th className="num">Exit</th>
                <th className="num">Points</th><th className="num">Gross</th><th className="num">Expense</th><th className="num">Net PnL</th>
                <th className="num">Combined P/L</th><th className="num">Combined %</th>
              </tr></thead>
              <tbody>
                {trades.length === 0 && <tr><td colSpan="16" className="empty">{isLoading ? 'Loading trades…' : 'No trades match the current filter.'}</td></tr>}
                {trades.map((t, i) => {
                  const nc = t.net_inr >= 0 ? 'u' : 'd', gc = t.gross_inr >= 0 ? 'u' : 'd'
                  const cc = t.combined_pl_inr >= 0 ? 'u' : 'd'
                  const dc = t.direction === 'LONG' ? 'l' : 's', rc = t.regime === 'BULL' ? 'bull' : 'bear'
                  const pts = t.points >= 0 ? '+' + t.points.toFixed(2) : t.points.toFixed(2)
                  const ptsC = t.points >= 0 ? 'u' : 'd'
                  const isExp = expanded === i
                  const isPairAnchor = pairAnchor[pairKey(t)] === i
                  return [
                    <tr key={i} className={isExp ? 'exp-row' : undefined} onClick={() => setExpanded(isExp ? null : i)} style={{ cursor: 'pointer' }}>
                      <td className="m">{fDate(t.date)}</td>
                      <td><span style={{ fontWeight: 700 }}>{t.client_name}</span>
                        <small style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', marginTop: 1 }}>
                          <span className="cat-dot" style={{ background: CAT_COLOR[t.category] || '#999' }}></span>
                          {t.client_code} · {t.category}</small></td>
                      <td className="m">{t.underlying}-FUT</td>
                      <td className="m">{fExpiry(t.expiry)}</td>
                      <td><span className={'tg2 ' + dc}>{t.direction}</span></td>
                      <td><span className={'regime-chip ' + rc}>{t.regime}</span></td>
                      <td className="num m">{t.lots.toLocaleString('en-IN')}</td>
                      <td className="num m">{t.qty.toLocaleString('en-IN')}</td>
                      <td className="num m">{fmtNum(t.entry)}</td>
                      <td className="num m">{fmtNum(t.exit)}</td>
                      <td className={'num m ' + ptsC}>{pts}</td>
                      <td className={'num m ' + gc}>{fL(t.gross_inr)}</td>
                      <td className="num m d">{fL(-t.charges_inr)}</td>
                      <td className={'num m ' + nc}>{fL(t.net_inr)}</td>
                      <td className={'num m pair-cell ' + (isPairAnchor ? cc : '')}>{isPairAnchor ? fL(t.combined_pl_inr || 0) : ''}</td>
                      <td className={'num m pair-cell ' + (isPairAnchor ? cc : '')}>{isPairAnchor ? (t.combined_pct >= 0 ? '+' : '') + Number(t.combined_pct || 0).toFixed(3) + '%' : ''}</td>
                    </tr>,
                    isExp && (
                      <tr className="exp-row" key={i + '-x'}><td colSpan="16">
                        <div className="charge-detail"><div className="cg">
                          <Ci l="Turnover" v={`₹${(t.turnover_inr / 1e7).toFixed(3)} Cr`} />
                          <Ci l="STT" d v={`₹${(t.stt_inr / 1e5).toFixed(2)} L`} />
                          <Ci l="Exchange" d v={`₹${(t.exch_inr / 1e5).toFixed(2)} L`} />
                          <Ci l="SEBI" d v={`₹${(t.sebi_inr / 1e3).toFixed(1)} K`} />
                          <Ci l="Stamp" d v={`₹${(t.stamp_inr / 1e5).toFixed(2)} L`} />
                          <Ci l="GST" d v={`₹${(t.gst_inr / 1e3).toFixed(1)} K`} />
                          <Ci l="Total Expense" d v={`₹${(t.charges_inr / 1e5).toFixed(2)} L`} />
                        </div></div>
                      </td></tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
          <div className="blotter-foot">Click any row to see full expense breakdown · STT · Exchange · SEBI · Stamp · GST</div>
        </div>
      </div>
      <div className="note">Orders · live data{data ? ` · ${data.summary.count} trades · click row for expense breakdown` : ''}</div>
    </div>
  )
}

const Ci = ({ l, v, d }) => <div className="ci"><div className="l">{l}</div><div className={'v' + (d ? ' d' : '')}>{v}</div></div>
