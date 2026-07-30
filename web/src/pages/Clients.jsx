import { Fragment, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '../api/client'
import MarketTickers from '../components/MarketTickers'
import LegPerformanceModal from '../components/LegPerformanceModal'
import { fCr, fCr1, fL, pctStr, fDate, fMonSh } from '../lib/clientsFmt'
import {
  cellLbl,
  filterMonthly, filterTrades, computeStats,
  RANGES, RLBL, RFULL, CAT_ORDER, CAT_CLS, CAT_LBL, CAT_RANGE,
} from '../lib/clientsChart'
import { hmColor, hmText } from '../lib/curve'   // dashboard heatmap palette (colour by %, not )
import {
  buildBacktestRows,
  buildDateCurvePath,
  compoundYearlyPct,
  dateLinePoints,
  equityDomain,
  equityValueDomain,
} from '../lib/equityBacktest'
import { fmtNum } from '../lib/format'
import { VARIANTS } from '../lib/variantData'
import { VARIANT_TRADES } from '../lib/variantTrades'
import { clientVariantBook } from '../lib/lotCalc'
import { periodMaxDdPct } from '../lib/returns'
import { capitalSchedule } from '../lib/capitalSchedule'
import { useEscClose } from '../lib/useEscClose'
import { formatMonthlyReturn } from '../lib/dashboardPresentation'
import { FloatingTooltip } from '../components/ViewportTooltip'
import './clients.css'

const CURVE_W = 800
const CURVE_H = 190
const CURVE_PAD = 18

export default function Clients() {
  const qc = useQueryClient()
  // Poll on the same :02-aligned 60s cadence as the ticker so the open-cycle live LTP (exit + PnL)
  // stays current in the Combined (server-marked recent_trades) and BankNifty (tk live LTP) tables.
  const live = { refetchInterval: () => 62000 - (Date.now() % 60000), refetchIntervalInBackground: true, staleTime: 0 }
  const { data, isError, error } = useQuery({ queryKey: ['clients'], queryFn: () => apiGet('/api/clients'), ...live })
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard'), ...live })
  const [openCode, setOpenCode] = useState(null)
  const [q, setQ] = useState('')
  const [selectedCat, setSelectedCat] = useState(null)   // null = all categories
  const [editClient, setEditClient] = useState(null)

  const tk = {
    nifty: dash?.positions?.find(p => p.underlying === 'NIFTY')?.ltp,
    mid: dash?.positions?.find(p => p.underlying === 'MIDCPNIFTY')?.ltp,
    date: dash?.latest_date,
  }

  return (
    <div className="pg-clients">
      <div className="subbar"><div className="in">
        <MarketTickers dash={dash} />
        <div className="ti"><span className="n">Data as of</span><span className="v">{dash?.latest_date || '—'}</span></div>
        <div className="rt"><div className="seg"><button className="on">All time</button><button>YTD</button><button>MTD</button></div></div>
      </div></div>

      <div className="shell">
        <div className="pagehd fu">
          <div>
            <div className="title">Clients</div>
            {(isError || !data) && (
              <div className="crumb">{isError ? `API error: ${String(error?.message)}` : 'Loading…'}</div>
            )}
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
          // one unified list across all categories, sorted by category then capital
          shown = [...shown].sort((a, b) =>
            CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || (b.aum_cr - a.aum_cr))
          const openCl = shown.find(c => c.code === openCode)
          return (
            <>
              <div className="client-list-wrap fu">
                <div className="clist-head">
                  <span>{shown.length} client{shown.length !== 1 ? 's' : ''} · {selectedCat || 'all categories'}</span>
                  <span className="clist-hint">click a row for the full breakdown</span>
                </div>
                <div className="tscroll clist-scroll">
                  <table className="clist">
                    <thead><tr>
                      <th>Start date</th><th>Client</th><th>Type</th>
                      <th className="num">Capital</th><th className="num">P&amp;L</th><th className="num">Current value</th>
                      <th className="num">Net Return</th><th className="num">Leverage</th><th aria-label="expand"></th>
                    </tr></thead>
                    <tbody>
                      {shown.map(c => (
                        <Fragment key={c.code}>
                          <ClientRow c={c} active={c.code === openCode}
                            onClick={() => setOpenCode(openCode === c.code ? null : c.code)} />
                          {openCode === c.code && openCl && (
                            <tr className="drawer-row">
                              <td colSpan={9} style={{ padding: '0 12px', borderBottom: 0 }}>
                                <Drawer cl={openCl} backtest={dash?.backtest?.series} backtestBaseAum={dash?.backtest?.base_aum_cr ?? 30} liveLtp={{ NIFTY: tk.nifty, MIDCPNIFTY: tk.mid }} onClose={() => setOpenCode(null)} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
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
  useEscClose(onClose)
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
          <div className="field"><label>Client total capital (Cr)</label>
            <input type="number" min="0.01" step="0.01" value={aumCr}
              onChange={e => {
                const v = e.target.value
                setAumCr(v)
                const cap = fieldNum(v)
                const alloc = fieldNum(allocationCr)
                if (alloc > cap) syncAllocation(v)
              }} />
          </div>
          <div className="field"><label>{strategy?.name || 'Strategy'} allocation (Cr)</label>
            <input type="number" min="0" step="0.01" value={allocationCr}
              onChange={e => syncAllocation(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>{strategy?.name || 'Strategy'} exposure (Cr)</label>
              <input type="number" min="0" step="0.01" value={exposureCr}
                onChange={e => syncExposure(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}><label>Leverage (×)</label>
              <input type="number" min="0" max="10" step="0.01" value={leverage}
                onChange={e => syncLeverage(e.target.value)} />
            </div>
          </div>
          <div style={{ background: 'var(--soft)', borderRadius: 10, padding: '10px 12px', fontSize: '0.71875rem', color: 'var(--muted)', fontWeight: 600 }}>
            This persists to Postgres. Client capital is the account-level AUM; allocation, exposure, and leverage are stored independently on this strategy mapping.
          </div>
          {err && <div style={{ color: 'var(--neg)', fontSize: '0.75rem', fontWeight: 700, marginTop: 10 }}>{err}</div>}
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
        <div><span>Allocation</span><b>{fCr(allocationCr)}</b><span style={{ fontSize: '0.625rem', color: 'var(--muted)', marginLeft: 3 }}>{allocPct}%</span></div>
        <div><span>Exposure</span><b>{fCr(exposureCr)}</b></div>
        <div><span>Lev</span><b>{fmtLev(leverage)}</b></div>
      </div>
      <div style={{ fontSize: '0.53125rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', margin: '9px 2px 0' }}>Net Exposure (long / short)</div>
      <div className="alloc-row" style={{ marginTop: 4 }}>
        <div><span>Long · Midcap</span><b>{fCr(legExpCr)}</b></div>
        <div><span>Short · Nifty</span><b>{fCr(legExpCr)}</b></div>
        <div><span>Margin · 12%</span><b>{fCr(marginCr)}</b></div>
      </div>
      <div className="mini">
        <div className="b"><div className="l">Sharpe</div><div className="v">{c.stats.sharpe}</div></div>
        <div className="b"><div className="l">Win rate</div><div className="v u">{c.stats.win_rate}%</div></div>
        <div className="b"><div className="l">Max DD</div><div className="v d">−{periodMaxDdPct(c.monthly)}%</div></div>
      </div>
      <span className={'strat-chip' + (active ? ' active' : '')} onClick={onToggle}>
        ● Pair Trading<span className="arr">▾</span>
      </span>
    </div>
  )
}

function ClientRow({ c, active, onClick }) {
  const strategy = primaryStrategy(c)
  const capCr = strategy?.allocation_cr ?? c.aum_cr
  const lev = strategy?.leverage ?? (capCr > 0 ? (strategy?.exposure_cr ?? capCr) / capCr : 1)
  const net = c.stats.net_inr
  const curValCr = capCr + net / 1e7                 // current valuation = capital + P&L
  const nc = net >= 0 ? 'u' : 'd'
  const instr = c.exec_type || 'F2F'                  // F2F = fut × fut pair · F2O = fut × option pair
  return (
    <tr className={'clist-row' + (active ? ' active' : '')} onClick={onClick}>
      <td className="m">{fDate(c.joined_at)}</td>
      <td><div className="clr-name"><b>{c.name}</b><span className={'chiplbl sm ' + CAT_CLS[c.category]}>{CAT_LBL[c.category]}</span></div></td>
      <td><span className="instr-chip" data-tooltip={instr === 'F2O' ? 'Future × Option pair (Midcap future × Nifty option)' : 'Future × Future pair (Midcap future × Nifty future)'}>{instr}</span></td>
      <td className="num m">{fCr(capCr)}</td>
      <td className={'num m ' + nc}>{fL(net)}</td>
      <td className="num m"><b>{fCr(curValCr)}</b></td>
      <td className={'num m ' + nc}>{pctStr(c.stats.return_pct)}</td>
      <td className="num m">{fmtLev(lev)}</td>
      <td className="num clr-caret">{active ? '▲' : '▸'}</td>
    </tr>
  )
}

// Contract display name from the EXPIRY date: {UNDERLYING}{DD}{MMM}{YYYY}FUT (e.g. MIDCPNIFTY28JUL2026FUT).
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const futContract = (underlying, expiry) => {
  const [Y, M, D] = String(expiry).slice(0, 10).split('-')
  return `${underlying}${D}${MON3[+M - 1]}${Y}FUT`
}

function Drawer({ cl, backtest, backtestBaseAum, liveLtp, onClose }) {
  useEscClose(onClose)
  const [rangeKey, setRangeKey] = useState('all')
  const [dInstr, setDInstr] = useState(cl.exec_type === 'F2O' ? 'opt' : 'fut')    // default to the client's own execution
  const [dIdx, setDIdx] = useState('combined')   // combined | banknifty
  const [returnBase, setReturnBase] = useState('capital')  // capital | cash (Return-on-Cash toggle)
  const [monthModal, setMonthModal] = useState(null)
  // Real F2O option trade book (from the DB); falls back to the hardcoded showcase data if the API
  // is unavailable (e.g. deployed frontend before option_trades is ingested to prod).
  const { data: optData } = useQuery({ queryKey: ['option-trades'], queryFn: () => apiGet('/api/option-trades'), staleTime: Infinity })
  const { data: lotSizes } = useQuery({ queryKey: ['lot-sizes'], queryFn: () => apiGet('/api/lot-sizes'), staleTime: 60_000 })
  const { data: chargeConfig } = useQuery({ queryKey: ['charge-config'], queryFn: () => apiGet('/api/charge-config'), staleTime: 60_000 })
  // Per-client OPTIONS book: real discrete lots + itemised charges + margin, computed server-side
  // (parity with the futures buildClientBook). Fetched only when the Options toggle is active.
  const { data: optBookData } = useQuery({
    queryKey: ['client-options', cl.code],
    queryFn: () => apiGet('/api/clients/' + cl.code + '/options'),
    enabled: dInstr === 'opt', staleTime: Infinity,
  })
  const optBook = dInstr === 'opt' ? optBookData : null
  const catCls = CAT_CLS[cl.category] || 'retail'
  const catLbl = CAT_LBL[cl.category] || cl.category.toUpperCase()
  const strategy = primaryStrategy(cl)
  const allocationCr = strategy?.allocation_cr ?? cl.aum_cr
  const exposureCr = strategy?.exposure_cr ?? allocationCr
  const leverage = strategy?.leverage ?? (allocationCr > 0 ? exposureCr / allocationCr : 0)
  // Capital timeline (pay-in / pay-out) for THIS client — drives the variant book's segmented sizing +
  // per-month return base, exactly like the server fut book. Null when the client has no events.
  const vSched = cl.capital_events?.length ? capitalSchedule(cl.capital_events, leverage) : null
  const cashCr = strategy?.cash_cr ?? allocationCr                            // cash share of allocation
  const pledgeCr = strategy?.pledge_cr ?? Math.max(0, allocationCr - cashCr)  // stock-pledge share
  // Return-on-Cash toggle: re-base every % stat (return, MoM, best month, Max DD) onto the CASH
  // portion instead of full capital.  amounts, Sharpe and win-rate are base-invariant.
  const onCash = returnBase === 'cash'
  const baseCr = onCash ? (cashCr || allocationCr) : allocationCr
  const aumInr = baseCr * 1e7                // RETURN % base — capital or cash per the toggle
  const deployedInr = exposureCr * 1e7       // deployed (capital × leverage) — the base P&L runs on
  // Variant toggle: Options / BankNifty take the 30 Cr backtest and scale  to THIS client's
  // DEPLOYED capital (exposure = allocation × leverage); return %/Sharpe/DD are the strategy's own.
  const optPerf = optData?.summary ? optData : VARIANTS.options   // DB-derived options perf (fallback: hardcoded)
  const vActive = dInstr === 'opt' ? optPerf : dIdx === 'banknifty' ? VARIANTS.banknifty : null
  const vBaseAum = vActive?.summary.base_aum_cr || 30
  const vScale = exposureCr / vBaseAum
  // Options + BankNifty variants: start from the client's join date, like Combined. cl.monthly is the
  // server's join-filtered fut series, so its first month is the client's first ACTUAL active month —
  // use it as the variant floor (hides pre-join months; Options book spans back to Mar 2019).
  const vFloor = (dIdx === 'banknifty' || dInstr === 'opt') ? cl.monthly?.[0]?.month : null
  // BankNifty: recompute per client from its 30 Cr trades with REAL rounded lot quantities (same model
  // as the fut Combined book) — drives MoM/stats/trades/PnL. Options stays on linear NAV-% scaling.
  const bnfMax = VARIANT_TRADES.banknifty.trades.reduce((mx, t) => (t.expiry > mx ? t.expiry : mx), '')
  const bnfBook = dIdx === 'banknifty'
    ? clientVariantBook(VARIANT_TRADES.banknifty.trades, {
        scaleAt: vSched ? vSched.scaleAt : exposureCr / 30,
        capitalAt: vSched ? vSched.capitalAt : () => allocationCr,
        joinFloor: vFloor, liveLtp, maxExpiry: bnfMax, lotHistory: lotSizes?.rows, rates: chargeConfig?.rates })
    : null
  let vCum = 0
  const srcMonthly = bnfBook
    ? bnfBook.monthly
    : optBook
      ? optBook.monthly                                  // server discrete-lot options book (real lots + charges + margin)
      : vActive
      ? vActive.monthly
          .filter(m => !vFloor || m.month >= vFloor)
          .map(m => {
            // Only clients with an ACTUAL capital change (a multi-step timeline) get per-month exposure
            // scaling, so the Options net matches its timeline-aware denominator. Flat-capital clients
            // (single initial pay-in) keep the old linear scale + basis — genuinely unchanged.
            const useTimeline = vSched && vSched.steps.length > 1
            const monthScale = useTimeline ? vSched.exposureAt(m.month) / vBaseAum : vScale
            const net = Math.round(m.net_inr * monthScale)
            vCum += net
            const cap = useTimeline ? Math.round(vSched.capitalAt(m.month) * 1e7) : null
            return { ...m, net_inr: net, gross_inr: net, charges_inr: 0, cumulative_inr: useTimeline ? vCum : Math.round(m.cumulative_inr * vScale), capital_inr: cap }
          })
      : cl.monthly
  const filtered = filterMonthly(srcMonthly, rangeKey)
  // Return-on-Cash toggle scales the capital base uniformly: base = capital × (baseCr / allocationCr).
  const baseFactor = allocationCr > 0 ? baseCr / allocationCr : 1
  const stats = computeStats(filtered, aumInr, baseFactor)
  // Per-month base = that month's capital (pay-in/pay-out timeline) × the toggle factor; falls back to
  // flat aumInr for variant months without capital_inr. Drives the heatmap + best-month %.
  const baseOf = m => (m.capital_inr != null && m.capital_inr > 0) ? m.capital_inr * baseFactor : aumInr
  const filteredBased = filtered.map(m => { const b = baseOf(m); return { ...m, pct: b > 0 ? m.net_inr / b * 100 : 0 } })
  const bestMoPct = filteredBased.length ? Math.max(...filteredBased.map(m => m.pct)) : 0
  // Timeframe-aware Max DD on the capital timeline (Combined) or flat base (variants), toggle-adjusted
  // via baseFactor — cash-flow-neutral, so a pay-in/pay-out never shows as a drawdown.
  const pairMaxDd = stats.max_dd_pct
  const trades = vActive ? [] : filterTrades(cl.recent_trades, filtered).map(t => ({ ...t, contract: futContract(t.underlying, t.expiry), net_pct: aumInr > 0 ? +(t.net_inr / aumInr * 100).toFixed(2) : 0 }))
  // the currently-open fut cycle = most-recent expiry in the live book (its Date cell gets highlighted)
  const openExpiry = (cl.recent_trades || []).reduce((mx, t) => (t.expiry > mx ? t.expiry : mx), '')
  const ch = cl.charges, chT = ch.total_inr || 1
  const nc = stats.net_inr >= 0 ? 'u' : 'd', rc = stats.return_pct >= 0 ? 'u' : 'd'
  const vScaledCr = vActive ? (allocationCr).toFixed(vScale < 1 ? 2 : 0) : null

  // Real per-trade blotter for the active variant (from the source Excels),  scaled to allocation.
  const vKey = dInstr === 'opt' ? 'options' : dIdx === 'banknifty' ? 'banknifty' : null
  const vTrades = vKey === 'banknifty'
    ? bnfBook.trades
        .map(g => {
          const net_inr = Math.round(g.net)
          return {
            date: g.date, underlying: g.underlying, expiry: g.expiry, direction: g.direction, entry: g.entry, exit: g.exit,
            contract: futContract(g.underlying, g.expiry),
            lots: g.cQty / g.lot, lot_size: g.lot,   // Size = lots × lot_size = client's rounded qty
            net_inr,
            net_pct: aumInr > 0 ? +(net_inr / aumInr * 100).toFixed(2) : 0,   // Net PnL % in bracket, like Combined
            combined_pl_inr: Math.round(g.combined),
            combined_pct: aumInr > 0 ? +(g.combined / aumInr * 100).toFixed(2) : 0,
          }
        })
        // latest first (by expiry month desc, then underlying) — matches the Combined/fut order
        .sort((a, b) => { const am = a.expiry.slice(0, 7), bm = b.expiry.slice(0, 7); return am < bm ? 1 : am > bm ? -1 : (a.underlying < b.underlying ? -1 : 1) })
    : vKey === 'options'
    ? (optBook
        ? optBook.recent.map(t => ({                        // real per-client lots + charges (server book)
            strategy: t.strategy, entry: t.entry, exit: t.exit, expiry: t.expiry,
            buy_sell: t.side, strike: t.strike, opt_type: t.opt_type, qty: t.opt_qty,
            opt_entry: t.opt_entry, opt_exit: t.opt_exit,
            net_inr: Math.round(t.net), pct: aumInr > 0 ? +(t.net / aumInr * 100).toFixed(2) : 0,
          }))
        : (optData?.trades || VARIANT_TRADES.options.trades).map(t => ({ ...t, net_inr: Math.round(t.pct / 100 * deployedInr) })))
    : []
  // BankNifty charges: total is qty-driven (from the rounded-lot book); split into STT/exch/SEBI/stamp/GST
  // by the source book's component proportions (per-cycle split isn't in the variant data).
  const vc = VARIANT_TRADES.banknifty.charges_inr
  const vChF = vKey === 'banknifty' && vc.total ? bnfBook.charges / vc.total : 0
  const vCh = vKey === 'banknifty' ? {
    stt_inr: Math.round(vc.stt * vChF), exch_inr: Math.round(vc.exch * vChF),
    sebi_inr: Math.round(vc.sebi * vChF), stamp_inr: Math.round(vc.stamp * vChF),
    gst_inr: Math.round(vc.gst * vChF), total_inr: Math.round(bnfBook.charges),
  } : null
  // Options: itemised charges + margin from the server discrete-lot book.
  const oCh = optBook ? {
    stt_inr: Math.round(optBook.charges.stt), exch_inr: Math.round(optBook.charges.exch),
    sebi_inr: Math.round(optBook.charges.sebi), stamp_inr: Math.round(optBook.charges.stamp),
    gst_inr: Math.round(optBook.charges.gst), total_inr: Math.round(optBook.charges.total),
  } : null
  const oMarginCr = optBook ? optBook.margin / 1e7 : null

  return (
    <div className="drawer-wrap open">
      <div className="drawer">
        <div className="d-head">
          <span className={'chiplbl ' + catCls}>{catLbl}</span>
          <b>{cl.name} · Pair Trading (Midcap × Nifty)</b>
          <span className="sub">{RFULL[rangeKey] || 'All time'} · {fCr(allocationCr)} allocation · {fmtLev(leverage)}</span>
          <button className="d-close" onClick={onClose}>×</button>
        </div>

        <div className="var-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '13px 18px', background: '#fff', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: '0.59375rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Index</span>
          {[['combined', 'Combined'], ['banknifty', 'BankNifty']].map(([k, label]) => (
            <button key={k} disabled={dInstr === 'opt'} className={'chip' + (dIdx === k ? ' on' : '')}
              onClick={() => dInstr !== 'opt' && setDIdx(k)}>{label}</button>
          ))}
          <span style={{ fontSize: '0.59375rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginLeft: 10 }}>Instrument</span>
          {cl.exec_type !== 'F2O' && <button className={'chip' + (dInstr === 'fut' ? ' on' : '')} onClick={() => setDInstr('fut')}>Future</button>}
          {cl.exec_type !== 'F2F' && <button className={'chip' + (dInstr === 'opt' ? ' on' : '')} onClick={() => setDInstr('opt')}>Options</button>}
          {/* time-range chips pushed to the right */}
          <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
            {RANGES.map(r => (
              <button key={r} className={'rng-chip' + (r === rangeKey ? ' active' : '')} onClick={() => setRangeKey(r)}>{RLBL[r]}</button>
            ))}
          </div>
        </div>

        <div className="var-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '12px 18px' }}>
          <span style={{ fontSize: '0.65625rem', color: 'var(--muted)' }}>
            cash {fCr(cashCr)} · pledge {fCr(pledgeCr)} of {fCr(allocationCr)} capital
          </span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.59375rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Return on</span>
            <button className={'chip' + (!onCash ? ' on' : '')} onClick={() => setReturnBase('capital')}>On Capital</button>
            <button className={'chip' + (onCash ? ' on' : '')} onClick={() => setReturnBase('cash')}>On Cash</button>
          </div>
        </div>

        <div className="d-hero">
          <Hk l="Net PnL" cls={nc} v={fL(stats.net_inr)} />
          <Hk l={onCash ? 'Return on Cash' : 'Net Return'} cls={rc} v={pctStr(stats.return_pct)} />
          <Hk l="Sharpe" v={stats.sharpe} />
          <Hk l="Win rate" cls="u" v={stats.win_rate + '%'} />
          <Hk l="Max DD" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
          <Hk l="Best Month" cls="u" v={pctStr(bestMoPct)} />
          <Hk l="Win months" v={stats.wins + ' / ' + stats.total_months} />
        </div>

        <EquityCurve monthly={filtered} allocationCr={allocationCr} deployedCr={exposureCr} backtest={vActive ? null : backtest} backtestBaseAum={backtestBaseAum} />

        <div className="d-sec">
          <div className="d-sec-l">Month-on-Month Net Returns · % of {onCash ? 'cash deployed' : 'strategy allocation'}</div>
          <div className="hmx hmx-top" style={{ gridTemplateColumns: '34px repeat(13,1fr)' }}><span></span>{['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].map((m, i) => <span key={i}>{m}</span>)}<span>YEAR</span></div>
          <Heatmap monthly={filteredBased} onCellClick={setMonthModal} />
        </div>

        <div className="d-sec">
          <div className="d-sec-l">Strategy Stats</div>
          <div className="stat-grid">
            <Sc l="Best month" cls="u" v={fL(stats.best_month_inr)} />
            <Sc l="Worst month" cls="d" v={fL(stats.worst_month_inr)} />
            <Sc l="Max drawdown" cls="d" v={'−' + pairMaxDd.toFixed(2) + '%'} />
            <Sc l="Gross PnL" v={fL(stats.gross_inr)} />
            <Sc l="Total Charges" v={fL(stats.charges_inr)} />
            <Sc l="Client capital" v={fCr(cl.aum_cr)} />
            <Sc l="Strategy allocation" v={fCr(allocationCr)} />
            <Sc l="Cash" cls={onCash ? 'u' : ''} v={fCr(cashCr)} />
            <Sc l="Stock pledge" v={fCr(pledgeCr)} />
            <Sc l="Strategy exposure" v={fCr(exposureCr)} />
            <Sc l="Leverage" v={fmtLev(leverage)} />
            <Sc l="Win months" v={stats.wins + ' / ' + stats.total_months} />
            <Sc l="Joined" v={fDate(cl.joined_at)} />
          </div>
        </div>

        {vKey === 'banknifty' ? (
          <>
            <div className="d-trades">
              <div className="tl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Trades · {cl.name} · BankNifty backtest · {vTrades.length} legs {vScale !== 1 && `· scaled to ${fCr(allocationCr)}`}</span>
                <button className="btn ghost" style={{ fontSize: '0.6875rem', padding: '4px 10px', marginRight: 8 }}
                  onClick={() => downloadTradesCsv(vTrades, cl.name, cl.code + '_BNF')}>↓ CSV</button>
              </div>
              <TradesTable trades={vTrades} openExpiry={vTrades.reduce((mx, t) => (t.expiry > mx ? t.expiry : mx), '')} />
            </div>
            <div className="d-charges">
              <Ci l="STT" v={`${(vCh.stt_inr / 1e5).toFixed(1)} L (${(vCh.stt_inr / vCh.total_inr * 100) | 0}%)`} />
              <Ci l="Exch. Turn." v={`${(vCh.exch_inr / 1e5).toFixed(1)} L (${(vCh.exch_inr / vCh.total_inr * 100) | 0}%)`} />
              <Ci l="SEBI Fees" v={`${(vCh.sebi_inr / 1e5).toFixed(1)} L (${(vCh.sebi_inr / vCh.total_inr * 100) | 0}%)`} />
              <Ci l="Stamp" v={`${(vCh.stamp_inr / 1e5).toFixed(1)} L (${(vCh.stamp_inr / vCh.total_inr * 100) | 0}%)`} />
              <Ci l="GST" v={`${(vCh.gst_inr / 1e5).toFixed(1)} L (${(vCh.gst_inr / vCh.total_inr * 100) | 0}%)`} />
              <Ci l="Total Charges" big v={fCr(vCh.total_inr / 1e7)} />
            </div>
          </>
        ) : vKey === 'options' ? (
          <>
            <div className="d-trades">
              <div className="tl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Trades · {cl.name} · {vTrades.length} trades{oMarginCr != null && ` · margin ${fCr(oMarginCr)}`}</span>
                <button className="btn ghost" style={{ fontSize: '0.6875rem', padding: '4px 10px', marginRight: 8 }}
                  onClick={() => downloadOptionsCsv(vTrades, cl.name, cl.code)}>↓ CSV</button>
              </div>
              <OptionsTradesTable trades={vTrades} />
            </div>
            {oCh && (
              <div className="d-charges">
                <Ci l="STT" v={`${(oCh.stt_inr / 1e5).toFixed(1)} L (${(oCh.stt_inr / oCh.total_inr * 100) | 0}%)`} />
                <Ci l="Exch. Turn." v={`${(oCh.exch_inr / 1e5).toFixed(1)} L (${(oCh.exch_inr / oCh.total_inr * 100) | 0}%)`} />
                <Ci l="SEBI Fees" v={`${(oCh.sebi_inr / 1e5).toFixed(1)} L (${(oCh.sebi_inr / oCh.total_inr * 100) | 0}%)`} />
                <Ci l="Stamp" v={`${(oCh.stamp_inr / 1e5).toFixed(1)} L (${(oCh.stamp_inr / oCh.total_inr * 100) | 0}%)`} />
                <Ci l="GST" v={`${(oCh.gst_inr / 1e5).toFixed(1)} L (${(oCh.gst_inr / oCh.total_inr * 100) | 0}%)`} />
                <Ci l="Total Charges" big v={fCr(oCh.total_inr / 1e7)} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="d-trades">
              <div className="tl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Executed orders · {cl.name} · {trades.length} in range</span>
                {trades.length > 0 && (
                  <button className="btn ghost" style={{ fontSize: '0.6875rem', padding: '4px 10px', marginRight: 8 }}
                    onClick={() => downloadTradesCsv(trades, cl.name, cl.code)}>
                    ↓ CSV
                  </button>
                )}
              </div>
              <TradesTable trades={trades} openExpiry={openExpiry} />
            </div>

            <div className="d-charges">
              <Ci l="STT" v={`${(ch.stt_inr / 1e5).toFixed(1)} L`} />
              <Ci l="Exch. Turn." v={`${(ch.exch_inr / 1e5).toFixed(1)} L`} />
              <Ci l="SEBI Fees" v={`${(ch.sebi_inr / 1e5).toFixed(1)} L`} />
              <Ci l="Stamp" v={`${(ch.stamp_inr / 1e5).toFixed(1)} L`} />
              <Ci l="GST" v={`${(ch.gst_inr / 1e5).toFixed(1)} L`} />
              <Ci l="Total Charges" big v={fCr(ch.total_inr / 1e7)} />
            </div>
          </>
        )}
      </div>
      {monthModal && <LegPerformanceModal period={monthModal} monthly={filteredBased} scaleInr={n => n} onClose={() => setMonthModal(null)} />}
    </div>
  )
}

const Hk = ({ l, v, cls }) => <div className="hk"><div className="l">{l}</div><div className={'v ' + (cls || '')}>{v}</div></div>
const Sc = ({ l, v, cls }) => <div className="sc"><div className="l">{l}</div><div className={'v ' + (cls || '')}>{v}</div></div>
const Ci = ({ l, v, big }) => <div className="ci"><div className="l">{l}</div><div className="v" style={big ? { fontSize: '0.875rem' } : undefined}>{v}</div></div>

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

function downloadOptionsCsv(trades, clientName, clientCode) {
  const header = ['Entry', 'Exit', 'Expiry', 'Nifty Option', 'Qty', 'Entry Price', 'Exit Price', 'Net %', 'Net PnL (INR)', 'Net PnL (L)']
  const rows = trades.map(t => [
    t.entry, t.exit, t.expiry,
    t.strike != null ? `${t.buy_sell || ''} ${Math.round(t.strike)} ${t.opt_type || ''}`.trim() : '',
    t.qty ?? '', t.opt_entry ?? '', t.opt_exit ?? '',
    t.pct.toFixed(2) + '%',
    Math.round(t.net_inr), (t.net_inr / 1e5).toFixed(2),
  ])
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv, ''], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${clientCode}_options_trades.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function OptionsTradesTable({ trades }) {
  if (!trades.length) return <p style={{ color: 'var(--muted)', fontSize: '0.75rem', padding: '12px 18px' }}>No trades found.</p>
  // Show the real Nifty option-leg contract when it's available (DB option_trades); the old hardcoded
  // showcase rows only carried strategy/dates/pct, so those columns render "—".
  const hasLegs = trades.some(t => t.strike != null)
  return (
    <div className="tscroll" style={{ margin: '8px 8px 12px', maxHeight: 360, overflowY: 'auto' }}>
      <table><thead><tr>
        <th>Entry</th><th>Exit</th><th>Expiry</th>
        {hasLegs && <><th>Nifty Option</th><th className="num">Qty</th><th className="num">Entry </th><th className="num">Exit </th></>}
        <th className="num">Net %</th><th className="num">Net PnL</th>
      </tr></thead><tbody>
        {trades.map((t, i) => {
          const nc = t.pct >= 0 ? 'u' : 'd'
          const contract = t.strike != null
            ? `${t.buy_sell || ''} ${Math.round(t.strike)} ${t.opt_type || ''}`.trim()
            : '—'
          return (
            <tr key={i}>
              <td className="m">{fDate(t.entry)}</td>
              <td className="m">{fDate(t.exit)}</td>
              <td className="m">{fDate(t.expiry)}</td>
              {hasLegs && <>
                <td className="m">{contract}</td>
                <td className="num m">{t.qty != null ? fmtNum(t.qty, 0) : '—'}</td>
                <td className="num m">{t.opt_entry != null ? fmtNum(t.opt_entry) : '—'}</td>
                <td className="num m">{t.opt_exit != null ? fmtNum(t.opt_exit) : '—'}</td>
              </>}
              <td className={'num m ' + nc}>{pctStr(t.pct)}</td>
              <td className={'num m ' + nc}>{fL(t.net_inr)}</td>
            </tr>
          )
        })}
      </tbody></table>
    </div>
  )
}

function TradesTable({ trades, openExpiry }) {
  if (!trades.length) return <p style={{ color: 'var(--muted)', fontSize: '0.75rem', padding: '12px 18px' }}>No trades found.</p>
  return (
    <div className="tscroll" style={{ margin: '8px 8px 12px' }}>
      <table><thead><tr>
        <th>Date</th><th>Symbol</th><th>Expiry</th><th className="num">Quantity</th>
        <th className="num">Entry</th><th className="num">Exit</th><th className="num">Points</th><th className="num">Net PnL</th>
        <th className="num">Combined P/L</th><th className="num">Combined %</th>
      </tr></thead><tbody>
        {trades.map((t, i) => {
          const nc = t.net_inr >= 0 ? 'u' : 'd'
          const cc = t.combined_pl_inr >= 0 ? 'u' : 'd'
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
              <td className="m" style={openExpiry && t.expiry === openExpiry ? { background: '#FDE68A' } : undefined}>{fDate(t.date)}</td>
              <td className="m">{t.underlying}</td>
              <td className="m">{fDate(t.expiry)}</td>
              <td className="num m">{fmtNum(t.lots * t.lot_size, 0)}</td>
              <td className="num m">{fmtNum(t.entry)}</td>
              <td className="num m">{fmtNum(t.exit)}</td>
              <td className="num m" style={{ color: 'var(--muted)' }}>{pts}</td>
              <td className={'num m ' + nc}>{fL(t.net_inr)}{t.net_pct != null && ` (${pctStr(t.net_pct)})`}</td>
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

function Heatmap({ monthly, onCellClick }) {
  const byYear = {}
  monthly.forEach(m => {
    const y = m.month.slice(0, 4), mo = parseInt(m.month.slice(5, 7), 10) - 1
    if (!byYear[y]) byYear[y] = new Array(12).fill(null)
    byYear[y][mo] = { net: m.net_inr, pct: m.pct }
  })
  const years = Object.keys(byYear).sort()
  return (
    <div className="hm" style={{ gridTemplateColumns: '34px repeat(13,minmax(0,1fr))' }}>
      {years.flatMap(y => {
        const cells = [<div key={y + '-yl'} className="yl">{"'" + y.slice(2)}</div>]
        byYear[y].forEach((cell, i) => {
          const moStr = i + 1 < 10 ? '0' + (i + 1) : '' + (i + 1)
          const monthISO = `${y}-${moStr}`
          const net = cell ? cell.net : null, pctv = cell ? cell.pct : null
          const tip = cell ? `${fMonSh(y + '-' + moStr + '-01')} ${fL(net)} (${formatMonthlyReturn(pctv)})` + (onCellClick ? ' · click for leg breakdown' : '') : ''
          const clickable = !!cell && !!onCellClick
          cells.push(
            <div key={y + '-' + i} className={'cell' + (cell ? '' : ' empty') + (clickable ? ' clickable' : '')}
              style={cell ? { background: hmColor(pctv), color: hmText(pctv) } : undefined} data-tooltip={tip || undefined}
              onClick={clickable ? () => onCellClick({ months: [monthISO], plabel: null, month: monthISO, quarter: false }) : undefined}>{cellLbl(pctv)}</div>
          )
        })
        const yearMonths = byYear[y].map((c, i) => c ? `${y}-${i + 1 < 10 ? '0' : ''}${i + 1}` : null).filter(Boolean)
        const yp = compoundYearlyPct(byYear[y].filter(Boolean).map(c => c.pct))
        const yrClickable = yearMonths.length > 0 && !!onCellClick
        const fireYear = () => onCellClick({ months: yearMonths, plabel: y, quarter: false })
        cells.push(
          <div key={y + '-yr'} className={'cell yr' + (yrClickable ? ' clickable' : '')} style={{ background: hmColor(yp), color: hmText(yp) }}
            data-tooltip={`${y} (compounded): ${formatMonthlyReturn(yp)}`+ (yrClickable ? ' · click for leg breakdown' : '')}
            onClick={yrClickable ? fireYear : undefined}>{cellLbl(yp)}</div>
        )
        return cells
      })}
    </div>
  )
}

function EquityCurve({ monthly, allocationCr, deployedCr, backtest, backtestBaseAum }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const [tip, setTip] = useState(null)
  const [showBacktest, setShowBacktest] = useState(true)
  const domain = equityDomain(monthly?.[0]?.month, monthly?.[monthly.length - 1]?.month, monthly)
  const liveRows = (monthly || []).map(row => ({ date: row.month, value: Number(row.cumulative_inr) || 0 }))
  // Scale the spot backtest to THIS client's DEPLOYED capital (exposure = allocation × leverage) —
  // the SAME base the live P&L curve runs on — so the gap between the two lines is the real
  // spot-vs-fut difference, not a leverage-scale mismatch. Falls back to allocation if no leverage.
  const backtestRows = buildBacktestRows(backtest, domain, deployedCr || allocationCr || backtestBaseAum || 30)
  const valueDomain = equityValueDomain(liveRows, backtestRows)
  const livePath = buildDateCurvePath(liveRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const livePts = dateLinePoints(liveRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const backtestPath = buildDateCurvePath(backtestRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const backtestPts = dateLinePoints(backtestRows, domain, valueDomain, CURVE_W, CURVE_H, CURVE_PAD)
  const zeroY = valueDomain.min < 0 && valueDomain.max > 0
    ? CURVE_H - CURVE_PAD - (0 - valueDomain.min) / (valueDomain.max - valueDomain.min || 1) * (CURVE_H - CURVE_PAD * 2)
    : null

  const foot = (() => {
    if (!monthly.length) return []
    // ~6 evenly spaced labels; replace (not append) the final tick if it's adjacent, to avoid crowding
    const step = Math.max(1, Math.ceil((monthly.length - 1) / 5))
    const idx = []
    for (let i = 0; i < monthly.length; i += step) idx.push(i)
    const last = monthly.length - 1
    if (idx[idx.length - 1] !== last) {
      if (last - idx[idx.length - 1] <= step / 2) idx[idx.length - 1] = last
      else idx.push(last)
    }
    return idx.map(i => fMonSh(monthly[i].month))
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
    setTip({ idx, gx: dot.x, gy: dot.y, left, top: Math.max(2, ptY - 92), clientX: e.clientX, clientY: e.clientY, mo: row.month, cum: row.cumulative_inr, net: row.net_inr, backtest: btIdx === null ? null : backtestRows[btIdx]?.value })
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
        <FloatingTooltip x={tip.clientX} y={tip.clientY} className="chart-tooltip client-curve-tooltip">
          <div className="tt-mo">{fMonSh(tip.mo)}</div>
          <div className="tt-row"><span>Cumulative</span><b className={tip.cum >= 0 ? 'u' : 'd'}>{fL(tip.cum)}</b></div>
          <div className="tt-row"><span>This month</span><b className={tip.net >= 0 ? 'u' : 'd'}>{fL(tip.net)}</b></div>
          {showBacktest && tip.backtest != null && <div className="tt-row"><span>Spot benchmark</span><b className={tip.backtest >= 0 ? 'u' : 'd'}>{fL(tip.backtest)}</b></div>}
        </FloatingTooltip>
      )}
      <div className="curve-foot">
        <div className="cf-ticks">{foot.map((f, i) => <span key={i}>{f}</span>)}</div>
        {backtestRows.length > 0 && <span className="bt-foot" onClick={() => setShowBacktest(v => !v)} data-tooltip="Click to show or hide the spot benchmark" style={{ cursor: 'pointer', userSelect: 'none', opacity: showBacktest ? 1 : 0.42 }}>Spot benchmark</span>}
      </div>
    </div>
  )
}
