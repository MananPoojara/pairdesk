import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '../api/client'
import { fCr, fCr1, fL, pctStr, fDate, fMonSh } from '../lib/clientsFmt'
import {
  cellClr, cellTxt, cellLbl,
  filterMonthly, filterTrades, computeStats,
  RANGES, RLBL, RFULL, CAT_ORDER, CAT_CLS, CAT_LBL, CAT_RANGE,
} from '../lib/clientsChart'
import {
  buildBacktestRows,
  buildDateCurvePath,
  dateLinePoints,
  equityDomain,
  equityValueDomain,
} from '../lib/equityBacktest'
import { fmtNum } from '../lib/format'
import { VARIANTS } from '../lib/variantData'
import './clients.css'

const CURVE_W = 800
const CURVE_H = 190
const CURVE_PAD = 18

export default function Clients() {
  const qc = useQueryClient()
  const { data, isError, error } = useQuery({ queryKey: ['clients'], queryFn: () => apiGet('/api/clients') })
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })
  const [openCode, setOpenCode] = useState(null)
  const [q, setQ] = useState('')
  const [selectedCat, setSelectedCat] = useState('HNI')
  const [editClient, setEditClient] = useState(null)

  const tk = {
    nifty: dash?.positions?.find(p => p.underlying === 'NIFTY')?.ltp,
    mid: dash?.positions?.find(p => p.underlying === 'MIDCPNIFTY')?.ltp,
    date: dash?.latest_date,
  }

  return (
    <div className="pg-clients">
      <div className="subbar"><div className="in">
        <div className="ti"><span className="n">NIFTY 50</span><span className="v">{tk.nifty ? fmtNum(tk.nifty) : '—'}</span></div>
        <div className="ti"><span className="n">MIDCAP SELECT</span><span className="v">{tk.mid ? fmtNum(tk.mid) : '—'}</span></div>
        <div className="ti"><span className="n">Data as of</span><span className="v">{tk.date || '—'}</span></div>
        <div className="rt"><div className="seg"><button className="on">All time</button><button>YTD</button><button>MTD</button></div></div>
      </div></div>

      <div className="shell">
        <div className="pagehd fu">
          <div>
            <div className="title">Clients</div>
            <div className="crumb">
              {isError ? `API error: ${String(error?.message)}` : !data ? 'Loading…' :
                `${data.clients.length} client${data.clients.length !== 1 ? 's' : ''} · ₹${data.summary.total_aum_cr.toFixed(1)} Cr AUM · net +₹${data.summary.total_net_cr.toFixed(2)} Cr`}
            </div>
          </div>
          <div className="controls">
            <input className="srch" placeholder="⌕ Search client…" value={q}
              onChange={e => setQ(e.target.value)} style={{ outline: 'none', minWidth: 190, color: 'var(--text)' }} />
          </div>
        </div>

        {data && <CatTiles summary={data.summary} selected={selectedCat} onSelect={cat => { setSelectedCat(cat); setOpenCode(null) }} />}
        {data && (() => {
          const ql = q.trim().toLowerCase()
          let shown = data.clients.filter(c => !ql || c.name.toLowerCase().includes(ql) || c.code.toLowerCase().includes(ql))
          if (selectedCat) shown = shown.filter(c => c.category === selectedCat)
          if (ql && !shown.length) return <div className="crumb" style={{ padding: '24px 2px' }}>No clients match &ldquo;{q}&rdquo;.</div>
          return (
          <div>
            {CAT_ORDER.map(cat => {
              const cats = shown.filter(c => c.category === cat)
              if (!cats.length) return null
              const info = data.summary.categories[cat]
              const cls = CAT_CLS[cat]
              const openCl = cats.find(c => c.code === openCode)
              return (
                <div className="cat-section" key={cat}>
                  <div className="sechd"><b>{cat}</b>
                    <span className={'chiplbl ' + cls}>{CAT_RANGE[cat]}</span>
                    <span className="ct">{info.count} client{info.count !== 1 ? 's' : ''} · ₹{info.aum_cr.toFixed(1)} Cr</span>
                    <div className="ln"></div>
                  </div>
                  <div className="crow">
                    {cats.map((c, idx) => (
                      <ClientCard key={c.code} c={c} cls={cls} cat={cat} idx={idx}
                        active={c.code === openCode}
                        onToggle={() => setOpenCode(openCode === c.code ? null : c.code)}
                        onEdit={() => setEditClient(c)} />
                    ))}
                  </div>
                  {openCl && <Drawer cl={openCl} backtest={dash?.backtest?.series} backtestBaseAum={dash?.backtest?.base_aum_cr ?? 30} onClose={() => setOpenCode(null)} />}
                </div>
              )
            })}
          </div>
          )
        })()}
      </div>
      {editClient && <CapitalModal client={editClient}
        onClose={() => setEditClient(null)}
        onSaved={() => {
          setEditClient(null)
          qc.invalidateQueries({ queryKey: ['clients'] })
          qc.invalidateQueries({ queryKey: ['dashboard'] })
          qc.invalidateQueries({ queryKey: ['orders'] })
          qc.invalidateQueries({ queryKey: ['strategies'] })
        }} />}
      <div className="note">Clients · live data · click the strategy chip on any card to drill in</div>
    </div>
  )
}

function primaryStrategy(client) {
  return client?.strategies?.find(s => s.code === 'MIDCAP_NIFTY_PAIR') || client?.strategies?.[0] || null
}

function fmtLev(n) {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(2) + '×' : '—'
}

function fieldNum(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function fixedInput(n, places = 2) {
  return Number.isFinite(n) ? String(+n.toFixed(places)) : '0'
}

function CapitalModal({ client, onClose, onSaved }) {
  const strategies = client.strategies?.length
    ? client.strategies
    : [{ code: 'MIDCAP_NIFTY_PAIR', name: 'Pair Trading (Midcap × Nifty)', allocation_cr: client.aum_cr, exposure_cr: client.aum_cr, leverage: 1 }]
  const initialStrategy = primaryStrategy({ strategies }) || strategies[0]
  const [strategyCode, setStrategyCode] = useState(initialStrategy.code)
  const strategy = strategies.find(s => s.code === strategyCode) || initialStrategy
  const initialAllocation = initialStrategy?.allocation_cr ?? client.aum_cr
  const initialExposure = initialStrategy?.exposure_cr ?? initialAllocation
  const initialLeverage = initialStrategy?.leverage ?? (initialAllocation > 0 ? initialExposure / initialAllocation : 0)
  const [aumCr, setAumCr] = useState(String(client.aum_cr))
  const [allocationCr, setAllocationCr] = useState(String(initialAllocation))
  const [exposureCr, setExposureCr] = useState(String(initialExposure))
  const [leverage, setLeverage] = useState(String(initialLeverage))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function syncAllocation(nextAllocation) {
    setAllocationCr(nextAllocation)
    const alloc = fieldNum(nextAllocation)
    const lev = fieldNum(leverage)
    setExposureCr(fixedInput(alloc * lev))
  }

  function syncExposure(nextExposure) {
    setExposureCr(nextExposure)
    const alloc = fieldNum(allocationCr)
    const expo = fieldNum(nextExposure)
    setLeverage(fixedInput(alloc > 0 ? expo / alloc : 0, 4))
  }

  function syncLeverage(nextLeverage) {
    setLeverage(nextLeverage)
    const alloc = fieldNum(allocationCr)
    const lev = fieldNum(nextLeverage)
    setExposureCr(fixedInput(alloc * lev))
  }

  function chooseStrategy(nextCode) {
    const next = strategies.find(s => s.code === nextCode) || initialStrategy
    const nextAllocation = next?.allocation_cr ?? client.aum_cr
    const nextExposure = next?.exposure_cr ?? nextAllocation
    const nextLeverage = next?.leverage ?? (nextAllocation > 0 ? nextExposure / nextAllocation : 0)
    setStrategyCode(next.code)
    setAllocationCr(String(nextAllocation))
    setExposureCr(String(nextExposure))
    setLeverage(String(nextLeverage))
  }

  async function save() {
    setErr('')
    const aum = Number(aumCr)
    const allocation = Number(allocationCr)
    const exposure = Number(exposureCr)
    const lev = Number(leverage)
    if (!Number.isFinite(aum) || aum <= 0) {
      setErr('Capital must be greater than zero.')
      return
    }
    if (!Number.isFinite(allocation) || allocation < 0 || allocation > aum) {
      setErr('Strategy allocation must be between zero and total capital.')
      return
    }
    if (!Number.isFinite(exposure) || exposure < 0) {
      setErr('Exposure must be zero or greater.')
      return
    }
    if (allocation === 0 && exposure > 0) {
      setErr('Exposure must be zero when strategy allocation is zero.')
      return
    }
    if (!Number.isFinite(lev) || lev < 0 || lev > 10) {
      setErr('Leverage must be between 0× and 10×.')
      return
    }
    if (allocation > 0 && exposure / allocation > 10) {
      setErr('Exposure cannot exceed 10× the strategy allocation.')
      return
    }
    setSaving(true)
    try {
      await apiPatch(`/api/clients/${encodeURIComponent(client.code)}/capital`, {
        aum_cr: aum,
        allocation_cr: allocation,
        exposure_cr: exposure,
        leverage: lev,
        strategy_code: strategy?.code || 'MIDCAP_NIFTY_PAIR',
      })
      onSaved()
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose() }}>
      <div className="modal">
        <div className="mh"><b>Edit capital · {client.name}</b><span className="x" onClick={onClose}>×</span></div>
        <div style={{ padding: '18px 22px' }}>
          <div className="field"><label>Strategy</label>
            <select value={strategyCode} onChange={e => chooseStrategy(e.target.value)}>
              {strategies.map(s => <option key={s.code} value={s.code}>{s.name || s.code}</option>)}
            </select>
          </div>
          <div className="field"><label>Client total capital (₹ Cr)</label>
            <input type="number" min="0.01" step="0.01" value={aumCr}
              onChange={e => {
                const v = e.target.value
                setAumCr(v)
                const cap = fieldNum(v)
                const alloc = fieldNum(allocationCr)
                if (alloc > cap) syncAllocation(v)
              }} />
          </div>
          <div className="field"><label>{strategy?.name || 'Strategy'} allocation (₹ Cr)</label>
            <input type="number" min="0" step="0.01" value={allocationCr}
              onChange={e => syncAllocation(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>{strategy?.name || 'Strategy'} exposure (₹ Cr)</label>
              <input type="number" min="0" step="0.01" value={exposureCr}
                onChange={e => syncExposure(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}><label>Leverage (×)</label>
              <input type="number" min="0" max="10" step="0.01" value={leverage}
                onChange={e => syncLeverage(e.target.value)} />
            </div>
          </div>
          <div style={{ background: 'var(--soft)', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
            This persists to Postgres. Client capital is the account-level AUM; allocation, exposure, and leverage are stored independently on this strategy mapping.
          </div>
          {err && <div style={{ color: 'var(--neg)', fontSize: 12, fontWeight: 700, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save capital'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CatTiles({ summary, selected, onSelect }) {
  return (
    <div className="bento fu" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
      {CAT_ORDER.map(cat => {
        const info = summary.categories[cat]
        const cls = CAT_CLS[cat]
        const aum = info ? info.aum_cr : 0
        const cnt = info ? info.count : 0
        const p = summary.total_aum_cr > 0 ? (aum / summary.total_aum_cr * 100).toFixed(1) : '0.0'
        const empty = cnt === 0
        const isSelected = selected === cat
        return (
          <div className={'t flexcol' + (isSelected ? ' cat-selected' : '')} key={cat}
            style={{ cursor: 'pointer', opacity: empty ? 0.6 : 1, outline: isSelected ? '2px solid var(--accent)' : undefined, borderRadius: isSelected ? 10 : undefined }}
            onClick={() => onSelect(isSelected ? null : cat)}>
            <div className="l"><span className={'chiplbl ' + cls}>{CAT_LBL[cat]}</span>
              <span className="meta">{empty ? 'No clients yet' : `${cnt} client${cnt !== 1 ? 's' : ''}`}</span></div>
            <div className="v" style={empty ? { color: 'var(--muted)' } : undefined}>{empty ? '—' : fCr1(aum)}</div>
            <div className="s">{empty ? 'Awaiting onboarding' : `${p}% of platform capital`}</div>
            <div className="catbar"><i style={{ width: p + '%' }}></i></div>
          </div>
        )
      })}
    </div>
  )
}

function ClientCard({ c, cls, cat, idx, active, onToggle, onEdit }) {
  const nc = c.stats.net_inr >= 0 ? 'u' : 'd'
  const strategy = primaryStrategy(c)
  const allocationCr = strategy?.allocation_cr ?? c.aum_cr
  const exposureCr = strategy?.exposure_cr ?? allocationCr
  const leverage = strategy?.leverage ?? (allocationCr > 0 ? exposureCr / allocationCr : 0)
  const allocPct = c.aum_cr > 0 ? (allocationCr / c.aum_cr * 100).toFixed(1) : '0.0'
  const marginCr = exposureCr * 0.12          // ~12% margin (SPAN + exposure) on notional
  const legExpCr = exposureCr / 2             // pair legs are notionally balanced — half the exposure each
  return (
    <div className="panel ccard fu" style={{ animationDelay: idx * 0.06 + 's' }}>
      <div className="top">
        <div><div className="nm">{c.name}</div><div className="reg">Joined: {fDate(c.joined_at)}</div></div>
        <span className={'chiplbl ' + cls}>{CAT_LBL[cat]}</span>
      </div>
      <div className="kvg">
        <div className="kv"><div className="l">Total capital</div><div className="v">{fCr(c.aum_cr)} <button className="mini-edit" onClick={onEdit}>✎</button></div></div>
        <div className="kv"><div className="l">Net PnL</div><div className={'v ' + nc}>{fL(c.stats.net_inr)}</div></div>
        <div className="kv"><div className="l">Return</div><div className={'v ' + nc}>{pctStr(c.stats.return_pct)}</div></div>
      </div>
      <div className="alloc-row">
        <div><span>Allocation</span><b>{fCr(allocationCr)}</b><span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 3 }}>{allocPct}%</span></div>
        <div><span>Exposure</span><b>{fCr(exposureCr)}</b></div>
        <div><span>Lev</span><b>{fmtLev(leverage)}</b></div>
      </div>
      <div style={{ fontSize: 8.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', margin: '9px 2px 0' }}>Net Exposure (long / short)</div>
      <div className="alloc-row" style={{ marginTop: 4 }}>
        <div><span>Long · Midcap</span><b>{fCr(legExpCr)}</b></div>
        <div><span>Short · Nifty</span><b>{fCr(legExpCr)}</b></div>
        <div><span>Margin · 12%</span><b>{fCr(marginCr)}</b></div>
      </div>
      <div className="mini">
        <div className="b"><div className="l">Sharpe</div><div className="v">{c.stats.sharpe}</div></div>
        <div className="b"><div className="l">Win rate</div><div className="v u">{c.stats.win_rate}%</div></div>
        <div className="b"><div className="l">Max DD</div><div className="v d">−{c.stats.max_dd_pct}%</div></div>
      </div>
      <span className={'strat-chip' + (active ? ' active' : '')} onClick={onToggle}>
        ● Pair Trading<span className="arr">▾</span>
      </span>
    </div>
  )
}

function Drawer({ cl, backtest, backtestBaseAum, onClose }) {
  const [rangeKey, setRangeKey] = useState('all')
  const [dInstr, setDInstr] = useState('fut')    // fut | opt
  const [dIdx, setDIdx] = useState('combined')   // combined | banknifty
  const catCls = CAT_CLS[cl.category] || 'retail'
  const catLbl = CAT_LBL[cl.category] || cl.category.toUpperCase()
  const strategy = primaryStrategy(cl)
  const allocationCr = strategy?.allocation_cr ?? cl.aum_cr
  const exposureCr = strategy?.exposure_cr ?? allocationCr
  const leverage = strategy?.leverage ?? (allocationCr > 0 ? exposureCr / allocationCr : 0)
  const aumInr = allocationCr * 1e7
  // Variant toggle: Options / BankNifty take the 30 Cr backtest and scale ₹ to THIS client's
  // allocation (return %, Sharpe, DD are the strategy's own; only the ₹ amounts scale).
  const vActive = dInstr === 'opt' ? VARIANTS.options : dIdx === 'banknifty' ? VARIANTS.banknifty : null
  const vScale = allocationCr / (vActive?.summary.base_aum_cr || 30)
  const srcMonthly = vActive
    ? vActive.monthly.map(m => ({ ...m, net_inr: Math.round(m.net_inr * vScale), gross_inr: Math.round(m.net_inr * vScale), charges_inr: 0, cumulative_inr: Math.round(m.cumulative_inr * vScale) }))
    : cl.monthly
  const filtered = filterMonthly(srcMonthly, rangeKey)
  const stats = computeStats(filtered, aumInr)
  const pairMaxDd = vActive ? Number(vActive.summary.pair_max_dd_pct)
    : Number(cl.stats?.pair_max_dd_pct ?? cl.stats?.max_dd_pct ?? stats.max_dd_pct)
  const trades = vActive ? [] : filterTrades(cl.recent_trades, filtered)
  const ch = cl.charges, chT = ch.total_inr || 1
  const nc = stats.net_inr >= 0 ? 'u' : 'd', rc = stats.return_pct >= 0 ? 'u' : 'd'
  const vScaledCr = vActive ? (allocationCr).toFixed(vScale < 1 ? 2 : 0) : null

  return (
    <div className="drawer-wrap open">
      <div className="drawer">
        <div className="d-head">
          <span className={'chiplbl ' + catCls}>{catLbl}</span>
          <b>{cl.name} · Pair Trading (Midcap × Nifty)</b>
          <span className="sub">{RFULL[rangeKey] || 'All time'} · {fCr(allocationCr)} allocation · {fmtLev(leverage)}</span>
          <button className="d-close" onClick={onClose}>×</button>
        </div>

        <div className="rng-bar">
          {RANGES.map(r => (
            <button key={r} className={'rng-chip' + (r === rangeKey ? ' active' : '')} onClick={() => setRangeKey(r)}>{RLBL[r]}</button>
          ))}
        </div>

        <div className="var-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '2px 18px 0' }}>
          <span style={{ fontSize: 9.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Index</span>
          {[['combined', 'Combined'], ['banknifty', 'BankNifty']].map(([k, label]) => (
            <button key={k} disabled={dInstr === 'opt'} className={'chip' + (dIdx === k ? ' on' : '')}
              onClick={() => dInstr !== 'opt' && setDIdx(k)}>{label}</button>
          ))}
          <span style={{ fontSize: 9.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginLeft: 8 }}>Instrument</span>
          <button className={'chip' + (dInstr === 'fut' ? ' on' : '')} onClick={() => setDInstr('fut')}>Fut</button>
          <button className={'chip' + (dInstr === 'opt' ? ' on' : '')} onClick={() => setDInstr('opt')}>Options</button>
        </div>
        {vActive && (
          <div style={{ margin: '8px 18px 0', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{vActive.summary.name.replace('Pair Trading — ', '')} variant</span>
            <span style={{ color: 'var(--muted)' }}>{vActive.summary.subtitle} · backtest scaled to {fCr(allocationCr)} allocation ({pctStr(vActive.summary.return_pct)} on {vActive.summary.base_aum_cr} Cr → {fL(Math.round(vActive.summary.net_inr * vScale))})</span>
          </div>
        )}

        <div className="d-hero">
          <Hk l="Net PnL" cls={nc} v={fL(stats.net_inr)} />
          <Hk l="Return" cls={rc} v={pctStr(stats.return_pct)} />
          <Hk l="Sharpe" v={stats.sharpe} />
          <Hk l="Win rate" cls="u" v={stats.win_rate + '%'} />
          <Hk l="Max DD" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
          <Hk l="Win months" v={stats.wins + ' / ' + stats.total_months} />
        </div>

        <EquityCurve monthly={filtered} allocationCr={allocationCr} backtest={vActive ? null : backtest} backtestBaseAum={backtestBaseAum} />

        <div className="d-sec">
          <div className="d-sec-l">Month-on-Month Returns · % of strategy allocation</div>
          <Heatmap monthly={filtered} />
          <div className="hmx"><span></span>{['J','F','M','A','M','J','J','A','S','O','N','D'].map((m, i) => <span key={i}>{m}</span>)}</div>
        </div>

        <div className="d-sec">
          <div className="d-sec-l">Strategy Stats · {RFULL[rangeKey] || 'All time'}</div>
          <div className="stat-grid">
            <Sc l="Best month" cls="u" v={fL(stats.best_month_inr)} />
            <Sc l="Worst month" cls="d" v={fL(stats.worst_month_inr)} />
            <Sc l="Max drawdown" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
            <Sc l="Gross PnL" v={fL(stats.gross_inr)} />
            <Sc l="Period charges" v={fL(stats.charges_inr)} />
            <Sc l="Client capital" v={fCr(cl.aum_cr)} />
            <Sc l="Strategy allocation" v={fCr(allocationCr)} />
            <Sc l="Strategy exposure" v={fCr(exposureCr)} />
            <Sc l="Leverage" v={fmtLev(leverage)} />
            <Sc l="Win months" v={stats.wins + ' / ' + stats.total_months} />
            <Sc l="Joined" v={fDate(cl.joined_at)} />
          </div>
        </div>

        {vActive ? (
          <div className="d-sec">
            <div className="d-sec-l">Trades · backtest</div>
            <p style={{ color: 'var(--muted)', fontSize: 12, padding: '4px 18px 14px' }}>
              This is the {vActive.summary.name.replace('Pair Trading — ', '')} backtest scaled to {cl.name}'s allocation — per-client trade blotter &amp; charge breakdown apply to the live Fut book only.
            </p>
          </div>
        ) : (
          <>
            <div className="d-trades">
              <div className="tl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Trades · {cl.name} · {trades.length} in range</span>
                {trades.length > 0 && (
                  <button className="btn ghost" style={{ fontSize: 11, padding: '4px 10px', marginRight: 8 }}
                    onClick={() => downloadTradesCsv(trades, cl.name, cl.code)}>
                    ↓ CSV
                  </button>
                )}
              </div>
              <TradesTable trades={trades} />
            </div>

            <div className="d-charges">
              <Ci l="STT" v={`₹${(ch.stt_inr / 1e5).toFixed(1)} L (${(ch.stt_inr / chT * 100) | 0}%)`} />
              <Ci l="Exchange" v={`₹${(ch.exch_inr / 1e5).toFixed(1)} L (${(ch.exch_inr / chT * 100) | 0}%)`} />
              <Ci l="SEBI" v={`₹${(ch.sebi_inr / 1e5).toFixed(1)} L (${(ch.sebi_inr / chT * 100) | 0}%)`} />
              <Ci l="Stamp" v={`₹${(ch.stamp_inr / 1e5).toFixed(1)} L (${(ch.stamp_inr / chT * 100) | 0}%)`} />
              <Ci l="GST" v={`₹${(ch.gst_inr / 1e5).toFixed(1)} L (${(ch.gst_inr / chT * 100) | 0}%)`} />
              <Ci l="Total (lifetime)" big v={fCr(ch.total_inr / 1e7)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const Hk = ({ l, v, cls }) => <div className="hk"><div className="l">{l}</div><div className={'v ' + (cls || '')}>{v}</div></div>
const Sc = ({ l, v, cls }) => <div className="sc"><div className="l">{l}</div><div className={'v ' + (cls || '')}>{v}</div></div>
const Ci = ({ l, v, big }) => <div className="ci"><div className="l">{l}</div><div className="v" style={big ? { fontSize: 14 } : undefined}>{v}</div></div>

function downloadTradesCsv(trades, clientName, clientCode) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const fmtDate = d => { const dt = new Date(d); return `${dt.getDate()} ${MON[dt.getMonth()]} '${String(dt.getFullYear()).slice(2)}` }
  const header = ['Date','Symbol','Side','Lots','Lot Size','Entry','Exit','Points','Net PnL (INR)','Net PnL (Cr)','Combined P/L (INR)','Combined P/L (Cr)','Combined %','Expiry','Contract','Regime']
  const rows = trades.map(t => {
    const pts = t.direction === 'LONG' ? (t.exit - t.entry).toFixed(2) : (t.entry - t.exit).toFixed(2)
    const netCr = (t.net_inr / 1e7).toFixed(4)
    const combCr = (t.combined_pl_inr / 1e7).toFixed(4)
    return [
      fmtDate(t.date),
      t.underlying,
      t.direction,
      t.lots,
      t.lot_size,
      t.entry.toFixed(2),
      t.exit.toFixed(2),
      pts,
      Math.round(t.net_inr),
      netCr,
      Math.round(t.combined_pl_inr),
      combCr,
      (t.combined_pct ?? 0).toFixed(2) + '%',
      t.expiry,
      t.contract,
      t.regime || '',
    ]
  })
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv, ''], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${clientCode}_trades.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function TradesTable({ trades }) {
  if (!trades.length) return <p style={{ color: 'var(--muted)', fontSize: 12, padding: '12px 18px' }}>No trades found.</p>
  return (
    <div className="tscroll" style={{ margin: '8px 8px 12px' }}>
      <table><thead><tr>
        <th>Date</th><th>Symbol</th><th>Side</th><th className="num">Size</th>
        <th className="num">Entry</th><th className="num">Exit</th><th className="num">Points</th><th className="num">Net PnL</th>
        <th className="num">Combined P/L</th><th className="num">Combined %</th>
      </tr></thead><tbody>
        {trades.map((t, i) => {
          const nc = t.net_inr >= 0 ? 'u' : 'd'
          const cc = t.combined_pl_inr >= 0 ? 'u' : 'd'
          const dc = t.direction === 'LONG' ? 'l' : 's'
          const pts = t.direction === 'LONG' ? (t.exit - t.entry).toFixed(2) : (t.entry - t.exit).toFixed(2)
          // The pair's combined P/L & % are identical on both legs — show them once,
          // merged across the two rows of the pair. A pair's legs share an EXPIRY MONTH
          // (not an entry date — they roll on independent contract schedules).
          const expMonth = t => String(t.expiry || '').slice(0, 7)
          const firstOfPair = i === 0 || expMonth(trades[i - 1]) !== expMonth(t)
          let pairSpan = 1
          if (firstOfPair) { let j = i + 1; while (j < trades.length && expMonth(trades[j]) === expMonth(t)) { pairSpan++; j++ } }
          return (
            <tr key={i}>
              <td className="m">{fDate(t.date)}</td>
              <td>{t.underlying}</td>
              <td><span className={'tg2 ' + dc}>{t.direction}</span></td>
              <td className="num m">{t.lots} lots</td>
              <td className="num m">{fmtNum(t.entry)}</td>
              <td className="num m">{fmtNum(t.exit)}</td>
              <td className="num m" style={{ color: 'var(--muted)' }}>{(t.net_inr >= 0 ? '+' : '') + pts}</td>
              <td className={'num m ' + nc}>{fL(t.net_inr)}</td>
              {firstOfPair && (
                <td className={'num m pair-cell ' + cc} rowSpan={pairSpan} style={{ verticalAlign: 'middle' }}>{fL(t.combined_pl_inr || 0)}</td>
              )}
              {firstOfPair && (
                <td className={'num m pair-cell ' + cc} rowSpan={pairSpan} style={{ verticalAlign: 'middle' }}>{pctStr(t.combined_pct || 0)}</td>
              )}
            </tr>
          )
        })}
      </tbody></table>
    </div>
  )
}

function Heatmap({ monthly }) {
  const byYear = {}
  monthly.forEach(m => {
    const y = m.month.slice(0, 4), mo = parseInt(m.month.slice(5, 7), 10) - 1
    if (!byYear[y]) byYear[y] = new Array(12).fill(null)
    byYear[y][mo] = { net: m.net_inr, pct: m.pct }
  })
  const years = Object.keys(byYear).sort()
  return (
    <div className="hm">
      {years.flatMap(y => {
        const cells = [<div key={y + '-yl'} className="yl">{"'" + y.slice(2)}</div>]
        byYear[y].forEach((cell, i) => {
          const moStr = i + 1 < 10 ? '0' + (i + 1) : '' + (i + 1)
          const net = cell ? cell.net : null, pctv = cell ? cell.pct : null
          const tip = cell ? `${fMonSh(y + '-' + moStr + '-01')} ${fL(net)} (${pctv >= 0 ? '+' : ''}${pctv.toFixed(2)}%)` : ''
          cells.push(
            <div key={y + '-' + i} className={'cell' + (cell ? '' : ' empty')}
              style={{ background: cellClr(net), color: cellTxt(net) }} title={tip || undefined}>{cellLbl(pctv)}</div>
          )
        })
        return cells
      })}
    </div>
  )
}

function EquityCurve({ monthly, allocationCr, backtest, backtestBaseAum }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const [tip, setTip] = useState(null)
  const [showBacktest, setShowBacktest] = useState(true)
  const domain = equityDomain(monthly?.[0]?.month, monthly?.[monthly.length - 1]?.month, monthly)
  const liveRows = (monthly || []).map(row => ({ date: row.month, value: Number(row.cumulative_inr) || 0 }))
  const backtestRows = buildBacktestRows(backtest, domain, backtestBaseAum ?? 30)
  const valueDomain = equityValueDomain(liveRows, [])
  const livePath = buildDateCurvePath(liveRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const livePts = dateLinePoints(liveRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const backtestPath = buildDateCurvePath(backtestRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const backtestPts = dateLinePoints(backtestRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const zeroY = valueDomain.min < 0 && valueDomain.max > 0
    ? CURVE_H - CURVE_PAD - (0 - valueDomain.min) / (valueDomain.max - valueDomain.min || 1) * (CURVE_H - CURVE_PAD * 2)
    : null

  const foot = (() => {
    if (!monthly.length) return []
    const step = Math.max(1, Math.ceil(monthly.length / 10))
    return monthly.filter((_, i) => i % step === 0 || i === monthly.length - 1).map(m => fMonSh(m.month))
  })()

  function onMove(e) {
    if (!livePts.length) return
    const svg = svgRef.current, wrap = wrapRef.current
    const rect = svg.getBoundingClientRect()
    if (!rect.width) return
    const vbX = (e.clientX - rect.left) / rect.width * CURVE_W
    let idx = 0, best = Infinity
    livePts.forEach((pt, i) => { const d = Math.abs(pt.x - vbX); if (d < best) { best = d; idx = i } })
    let btIdx = null, btBest = Infinity
    if (showBacktest) {
      backtestPts.forEach((pt, i) => { const d = Math.abs(pt.x - vbX); if (d < btBest) { btBest = d; btIdx = i } })
    }
    const dot = livePts[idx]
    const row = monthly[idx]
    const wrect = wrap.getBoundingClientRect()
    const ptX = rect.left - wrect.left + dot.x / CURVE_W * rect.width
    const ptY = rect.top - wrect.top + dot.y / CURVE_H * rect.height
    const left = ptX > wrap.clientWidth / 2 ? ptX - 130 : ptX + 14
    setTip({ idx, gx: dot.x, gy: dot.y, left, top: Math.max(2, ptY - 92), mo: row.month, cum: row.cumulative_inr, net: row.net_inr, backtest: btIdx === null ? null : backtestRows[btIdx]?.value })
  }

  if (!monthly?.length) {
    return <div className="curve-wrap" ref={wrapRef}>
      <div className="curve-lbl"><span>Equity Curve · cumulative net PnL · Midcap × Nifty Pair Trade</span></div>
      <svg className="curve-svg" viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none" />
      <div className="curve-foot" />
    </div>
  }

  return (
    <div className="curve-wrap" ref={wrapRef}>
      <div className="curve-lbl">
        <span>Equity Curve · cumulative net PnL · Midcap × Nifty Pair Trade</span>
        <button className={'bt-toggle ' + (showBacktest ? 'on' : '')} onClick={() => setShowBacktest(v => !v)}>
          <span></span>Backtest
        </button>
      </div>
      <svg className="curve-svg" viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none" ref={svgRef}>
        <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.22" /><stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.01" />
        </linearGradient></defs>
        {zeroY !== null && <line x1={CURVE_PAD} y1={zeroY.toFixed(1)} x2={CURVE_W - CURVE_PAD} y2={zeroY.toFixed(1)} stroke="#CBD5E1" strokeWidth="1" strokeDasharray="4,3" />}
        {showBacktest && backtestRows.length > 0 && (
          <g className="backtest-line">
            <path d={backtestPath.line} fill="none" stroke="#F97316" strokeWidth="2.1" strokeDasharray="5 4" />
          </g>
        )}
        <path d={livePath.fill} fill="url(#cg)" />
        <path d={livePath.line} fill="none" stroke="#0EA5E9" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {livePts.map((dt, i) => (
          <circle key={monthly[i].month} cx={dt.x.toFixed(1)} cy={dt.y.toFixed(1)} r="3.5" fill={monthly[i].net_inr >= 0 ? '#0EA5E9' : '#F97316'} stroke="#fff" strokeWidth="1.5" />
        ))}
        {tip && <line x1={tip.gx} y1={CURVE_PAD - 4} x2={tip.gx} y2={CURVE_H - CURVE_PAD} stroke="#0F1B2D" strokeWidth="1" strokeDasharray="3,3" style={{ pointerEvents: 'none' }} />}
        {tip && <circle cx={tip.gx} cy={tip.gy} r="5" fill="#0F1B2D" stroke="#fff" strokeWidth="2" style={{ pointerEvents: 'none' }} />}
        <rect x="0" y="0" width={CURVE_W} height={CURVE_H} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => setTip(null)} />
      </svg>
      {tip && (
        <div className="crv-tip" style={{ opacity: 1, left: tip.left, top: tip.top }}>
          <div className="tt-mo">{fMonSh(tip.mo)}</div>
          <div className="tt-row"><span>Cumulative</span><b className={tip.cum >= 0 ? 'u' : 'd'}>{fL(tip.cum)}</b></div>
          <div className="tt-row"><span>This month</span><b className={tip.net >= 0 ? 'u' : 'd'}>{fL(tip.net)}</b></div>
          {showBacktest && tip.backtest != null && <div className="tt-row"><span>Backtest</span><b className={tip.backtest >= 0 ? 'u' : 'd'}>{fL(tip.backtest)}</b></div>}
        </div>
      )}
      <div className="curve-foot">
        {foot.map((f, i) => <span key={i}>{f}</span>)}
        {showBacktest && <span className="bt-foot">Spot backtest</span>}
      </div>
    </div>
  )
}
