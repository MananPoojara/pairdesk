import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiDelete, apiPost } from '../api/client'
import rawHtml from './admin.body.html?raw'
import './admin.css'

// ── Helpers ──────────────────────────────────────────────────────────────────
function codeFromName(name) {
  return name.trim().toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .split(/\s+/).filter(Boolean)
    .map(w => w.slice(0, 3)).join('_').slice(0, 20) || ''
}

function fieldNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function fixedInput(n, places = 2) { return Number.isFinite(n) ? String(+n.toFixed(places)) : '0' }

// Format raw INR with Indian commas  e.g. 10000000 → "1,00,00,000"
function fmtInrRaw(val) {
  const s = String(val).replace(/[^0-9]/g, '')
  if (!s) return ''
  if (s.length <= 3) return s
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
}

// Parse comma-formatted string to plain number string
function parseInr(v) { return v.replace(/,/g, '') }

// Convert raw INR (as number) to Cr
const INR_TO_CR = 1e7
function inrToCr(inr) { return inr / INR_TO_CR }
function crToInr(cr) { return cr * INR_TO_CR }

// ── Add Client Modal ─────────────────────────────────────────────────────────
function AddClientModal({ onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeManual, setCodeManual] = useState(false)
  const [category, setCategory] = useState('Institution')
  const [joinedAt, setJoinedAt] = useState(today)
  // INR raw strings with commas for display
  const [aumInr, setAumInr] = useState('')
  const [expoInr, setExpoInr] = useState('')
  const [leverage, setLeverage] = useState('1')
  const [brokeragePct, setBrokeragePct] = useState('0')
  const [taxPct, setTaxPct] = useState('0')
  const [execType, setExecType] = useState('F2F')     // F2F (fut×fut) | F2O (fut×option)
  const [cashInr, setCashInr] = useState('')          // cash component of allocation
  const [pledgeInr, setPledgeInr] = useState('')      // stock-pledge component (allocation = cash + pledge)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function handleName(v) { setName(v); if (!codeManual) setCode(codeFromName(v)) }

  function handleInrInput(raw, setter) {
    const digits = raw.replace(/[^0-9]/g, '')
    setter(fmtInrRaw(digits))
  }

  // Allocation is derived = cash + stock pledge. Exposure defaults to allocation × leverage.
  function recalcExpo(cashStr, pledgeStr, lev) {
    const alloc = fieldNum(parseInr(cashStr)) + fieldNum(parseInr(pledgeStr))
    setExpoInr(fmtInrRaw(String(Math.round(alloc * fieldNum(lev)))))
  }

  function syncCash(next) {
    handleInrInput(next, setCashInr)
    recalcExpo(next, pledgeInr, leverage)
  }

  function syncPledge(next) {
    handleInrInput(next, setPledgeInr)
    recalcExpo(cashInr, next, leverage)
  }

  function syncExpo(next) {
    handleInrInput(next, setExpoInr)
    const alloc = fieldNum(parseInr(cashInr)) + fieldNum(parseInr(pledgeInr)), expo = fieldNum(parseInr(next))
    setLeverage(fixedInput(alloc > 0 ? expo / alloc : 0, 4))
  }

  function syncLev(next) {
    setLeverage(next)
    recalcExpo(cashInr, pledgeInr, next)
  }

  function handleAum(raw) {
    handleInrInput(raw, setAumInr)
  }

  async function save() {
    setErr('')
    if (!name.trim()) { setErr('Client name is required.'); return }
    if (!code.trim()) { setErr('Client code is required.'); return }
    const aumRaw = fieldNum(parseInr(aumInr))
    if (!aumRaw || aumRaw <= 0) { setErr('Total capital must be greater than zero.'); return }
    const cashRaw = fieldNum(parseInr(cashInr))
    const pledgeRaw = fieldNum(parseInr(pledgeInr))
    const allocRaw = cashRaw + pledgeRaw                                       // allocation = cash + stock pledge
    const expoRaw  = expoInr !== '' ? fieldNum(parseInr(expoInr)) : allocRaw
    const lev = leverage !== '' ? Number(leverage) : 1
    const brok = Number(brokeragePct) || 0
    const tax  = Number(taxPct) || 0
    if (cashRaw < 0 || pledgeRaw < 0) { setErr('Cash and stock pledge must be ≥ 0.'); return }
    if (allocRaw <= 0) { setErr('Enter cash and/or stock pledge — allocation must be greater than zero.'); return }
    if (allocRaw > aumRaw) { setErr('Cash + stock pledge cannot exceed total capital.'); return }
    if (expoRaw < 0) { setErr('Exposure must be >= 0.'); return }
    if (lev < 0 || lev > 10) { setErr('Leverage must be between 0× and 10×.'); return }
    if (brok < 0 || brok > 100) { setErr('Brokerage % must be between 0 and 100.'); return }
    if (tax < 0 || tax > 100) { setErr('Tax % must be between 0 and 100.'); return }
    setSaving(true)
    try {
      await apiPost('/api/clients', {
        name: name.trim(), code: code.trim(), category,
        aum_cr: inrToCr(aumRaw),
        allocation_cr: inrToCr(allocRaw),
        exposure_cr: inrToCr(expoRaw),
        leverage: lev,
        joined_at: joinedAt || today,
        strategy_code: 'MIDCAP_NIFTY_PAIR',
        brokerage_pct: brok,
        tax_pct: tax,
        exec_type: execType,
        cash_cr: inrToCr(cashRaw),
        pledge_cr: inrToCr(pledgeRaw),
      })
      onSaved()
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const cashNum   = fieldNum(parseInr(cashInr))
  const pledgeNum = fieldNum(parseInr(pledgeInr))
  const allocNum  = cashNum + pledgeNum
  const expoNum   = fieldNum(parseInr(expoInr)) || allocNum
  const levVal    = allocNum > 0 ? expoNum / allocNum : 0

  // Portal to <body> so the fixed overlay isn't trapped by the shell's animation transform
  // (an identity `transform` on an ancestor makes position:fixed anchor to it, not the viewport).
  return createPortal(
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose() }}>
      <div className="modal modal-form">
        <div className="mh"><b>Add client</b><span className="x" onClick={onClose}>×</span></div>
        <div className="modal-body">
          <div className="field"><label>Client name</label>
            <input placeholder="e.g. Manan Pujara" value={name} onChange={e => handleName(e.target.value)} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 2 }}><label>Client code <span style={{ fontWeight: 400, fontSize: 10.5, color: 'var(--muted)' }}>(auto-suggested)</span></label>
              <input placeholder="e.g. MAN_PUJ" value={code}
                onChange={e => { setCodeManual(true); setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')) }} />
            </div>
            <div className="field" style={{ flex: 1 }}><label>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option>Retail</option><option>HNI</option><option>Institution</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}><label>Type</label>
              <select value={execType} onChange={e => setExecType(e.target.value)}>
                <option value="F2F">F2F · fut×fut</option><option value="F2O">F2O · fut×option</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>Total capital (₹)</label>
              <input placeholder="e.g. 10,00,000" value={aumInr} onChange={e => handleAum(e.target.value)} />
              {aumInr && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{(fieldNum(parseInr(aumInr)) / INR_TO_CR).toFixed(4)} Cr</div>}
            </div>
            <div className="field" style={{ flex: 1 }}><label>Joined date</label>
              <input type="date" value={joinedAt} onChange={e => setJoinedAt(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>Cash (₹)</label>
              <input placeholder="e.g. 4,00,000" value={cashInr} onChange={e => syncCash(e.target.value)} />
              {cashInr && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{(cashNum / INR_TO_CR).toFixed(4)} Cr</div>}
            </div>
            <div className="field" style={{ flex: 1 }}><label>Stock Pledge (₹)</label>
              <input placeholder="e.g. 6,00,000" value={pledgeInr} onChange={e => syncPledge(e.target.value)} />
              {pledgeInr && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{(pledgeNum / INR_TO_CR).toFixed(4)} Cr</div>}
            </div>
          </div>
          {allocNum > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, margin: '-2px 0 12px' }}>Allocation = Cash + Stock Pledge = <b style={{ color: 'var(--text)' }}>₹{(allocNum / INR_TO_CR).toFixed(2)} Cr</b></div>}
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>Strategy exposure (₹)</label>
              <input placeholder={aumInr || '0'} value={expoInr} onChange={e => syncExpo(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}><label>Leverage (×)</label>
              <input type="number" min="0" max="10" step="0.01" value={leverage} onChange={e => syncLev(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>Brokerage (%)</label>
              <input type="number" min="0" max="100" step="0.001" placeholder="0" value={brokeragePct} onChange={e => setBrokeragePct(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}><label>Tax on brokerage (%)</label>
              <input type="number" min="0" max="100" step="0.01" placeholder="0" value={taxPct} onChange={e => setTaxPct(e.target.value)} />
            </div>
          </div>
          <div style={{ background: 'var(--soft)', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
            Strategy: Pair Trading (Midcap × Nifty)
            {allocNum > 0 && <span style={{ marginLeft: 12 }}>· Lev {levVal.toFixed(2)}× · Exp ₹{fmtInrRaw(String(Math.round(expoNum)))}</span>}
          </div>
          {err && <div style={{ color: 'var(--neg)', fontSize: 12, fontWeight: 700, marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add client'}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Client Management ────────────────────────────────────────────────────────
function ClientsManagement() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['clients'], queryFn: () => apiGet('/api/clients') })
  const [removing, setRemoving] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [err, setErr] = useState(null)

  async function handleRemove(code, name) {
    if (!window.confirm(`Deactivate "${name}" (${code})? They will no longer appear in the platform.`)) return
    setRemoving(code)
    setErr(null)
    try {
      await apiDelete(`/api/clients/${code}`)
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="pth" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span><b>Client management</b><span className="pill" style={{ marginLeft: 8 }}>Live</span></span>
        <button className="btn" style={{ fontSize: 12, padding: '5px 14px' }} onClick={() => setAddOpen(true)}>+ Add client</button>
      </div>
      {err && <div className="warn" style={{ margin: '0 18px 0' }}>⚠ {err}</div>}
      {addOpen && <AddClientModal onClose={() => setAddOpen(false)} onSaved={() => {
        setAddOpen(false)
        qc.invalidateQueries({ queryKey: ['clients'] })
        qc.invalidateQueries({ queryKey: ['dashboard'] })
      }} />}
      <div className="tscroll">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Code</th>
              <th>Category</th>
              <th>AUM</th>
              <th>Allocation</th>
              <th>Net P&L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: '18px 0' }}>Loading…</td></tr>}
            {data?.clients.map(c => {
              const strat = c.strategies?.[0]
              return (
                <tr key={c.code}>
                  <td><b>{c.name}</b></td>
                  <td className="m">{c.code}</td>
                  <td><span className="pill">{c.category}</span></td>
                  <td>₹{c.aum_cr} Cr</td>
                  <td>{strat ? `₹${strat.allocation_cr} Cr` : '—'}</td>
                  <td style={{ color: c.stats.net_inr >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {c.stats.net_inr >= 0 ? '+' : ''}₹{(c.stats.net_inr / 1e7).toFixed(2)} Cr
                  </td>
                  <td>
                    <button
                      className="btn ghost"
                      style={{ fontSize: 11.5, padding: '4px 10px', color: 'var(--neg)' }}
                      disabled={removing === c.code}
                      onClick={() => handleRemove(c.code, c.name)}
                    >
                      {removing === c.code ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {data?.clients.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: '18px 0' }}>No active clients.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Admin() {
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })
  const exposure = dash ? `₹${dash.book.aum_cr.toFixed(1)} Cr` : '…'
  const html = rawHtml.replace('__EXPOSURE__', exposure)
  // Place "Client management" INSIDE the shell, directly under "Risk & sizing defaults":
  // split the static HTML into subbar / shell body / note, strip the shell wrapper, then
  // re-wrap [risk defaults] + <ClientsManagement/> + [rest of the sections] in one shell.
  const noteIdx = html.indexOf('<div class="note">')
  const note = noteIdx >= 0 ? html.slice(noteIdx) : ''
  const beforeNote = noteIdx >= 0 ? html.slice(0, noteIdx) : html
  const shellStart = beforeNote.indexOf('<div class="shell')
  const subbar = beforeNote.slice(0, shellStart)
  const inner = beforeNote.slice(shellStart)
    .replace(/^<div class="shell fu">/, '')
    .replace(/<\/div>\s*$/, '')
  const [risk, rest] = inner.split('<!-- 3 · Charge / tax configuration -->')
  return (
    <div className="pg-admin">
      <div dangerouslySetInnerHTML={{ __html: subbar }} />
      <div className="shell fu">
        <div dangerouslySetInnerHTML={{ __html: risk }} />
        <ClientsManagement />
        <div dangerouslySetInnerHTML={{ __html: '<!-- 3 · Charge / tax configuration -->' + (rest || '') }} />
      </div>
      <div dangerouslySetInnerHTML={{ __html: note }} />
    </div>
  )
}
