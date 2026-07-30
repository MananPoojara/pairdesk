import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../api/client'
import MarketTickers from '../components/MarketTickers'
import { useEscClose } from '../lib/useEscClose'
import './history.css'

const CR = 1e9   // paise per crore
const fAmt = (paise) => {
  const a = Math.abs(Number(paise) || 0)
  return a >= CR ? (a / CR).toFixed(2) + ' Cr' : (a / 1e7).toFixed(2) + ' L'   // 1 L = 1e7 paise
}
const fSigned = (paise, type) => (type === 'PAY_OUT' ? '−' : '+') + fAmt(paise)

// Admin bookkeeping: record a pay-in / pay-out that already settled in the bank (no payment gateway —
// the app is the system of record). Appends to capital_events and re-syncs balances + returns.
function RecordEntryModal({ clients, onClose, onSaved }) {
  useEscClose(onClose)
  const [code, setCode] = useState(clients[0]?.code || '')
  const [type, setType] = useState('PAY_IN')
  const [date, setDate] = useState('')
  const [amountRs, setAmountRs] = useState('')   // entered in rupees; stored as Cr (÷ 1e7)
  const [ref, setRef] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const client = clients.find(c => c.code === code)
  const rupees = Number(amountRs)
  const amountCr = Number.isFinite(rupees) && rupees > 0 ? rupees / 1e7 : 0   // 1 Cr = ₹1,00,00,000

  const save = async () => {
    setErr('')
    if (!code) return setErr('Pick a client.')
    if (!date) return setErr('Pick an effective date.')
    if (!Number.isFinite(rupees) || rupees <= 0) return setErr('Amount must be greater than zero.')
    setSaving(true)
    try {
      const r = await apiPost('/api/capital-events', { client_code: code, effective_date: date, type, amount_cr: amountCr, ref: ref.trim() || undefined })
      onSaved(r)
    } catch (e) {
      setErr(String(e?.message || e).replace(/^Error:\s*/, ''))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose() }}>
      <div className="modal">
        <div className="mh"><b>Record Pay-in / Pay-out</b><span className="x" onClick={onClose}>×</span></div>
        <div style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>Client</label>
              <select value={code} onChange={e => setCode(e.target.value)}>
                {clients.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}><label>Current balance</label>
              <input type="text" readOnly value={client ? fAmt((client.aum_cr || 0) * CR) : '—'}
                style={{ background: 'var(--soft)', color: 'var(--muted)', fontWeight: 600, cursor: 'default' }} />
            </div>
          </div>
          <div className="field"><label>Type</label>
            <div className="lsf">
              <button className={type === 'PAY_IN' ? 'on' : undefined} onClick={() => setType('PAY_IN')}>Pay-in</button>
              <button className={type === 'PAY_OUT' ? 'on' : undefined} onClick={() => setType('PAY_OUT')}>Pay-out</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>Effective date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}><label>Amount (Rs.)</label>
              <input type="number" min="1" step="1" placeholder="e.g. 10,00,000" value={amountRs} onChange={e => setAmountRs(e.target.value)} />
              {amountCr > 0 && <div style={{ fontSize: '0.65625rem', color: 'var(--muted)', fontWeight: 600, marginTop: 3 }}>= {amountCr.toFixed(2)} Cr</div>}
            </div>
          </div>
          <div className="field"><label>Mode / Ref (optional)</label>
            <input type="text" placeholder="e.g. RTGS · UTR8820" value={ref} onChange={e => setRef(e.target.value)} />
          </div>
          {err && <div style={{ color: 'var(--neg)', fontSize: '0.75rem', fontWeight: 700, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record entry'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function History() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('all')   // all | PAY_IN | PAY_OUT
  const [modal, setModal] = useState(false)
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })
  const { data: clientsData } = useQuery({ queryKey: ['clients'], queryFn: () => apiGet('/api/clients') })
  const { data, isLoading, isError } = useQuery({ queryKey: ['capital-events'], queryFn: () => apiGet('/api/capital-events') })

  const clients = clientsData?.clients || []
  const s = data?.summary
  const all = data?.events || []
  const events = all.filter(e => filter === 'all' || e.type === filter)

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ['capital-events'] })
    qc.invalidateQueries({ queryKey: ['clients'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    setModal(false)
  }

  return (
    <div className="pg-history">
      {modal && <RecordEntryModal clients={clients} onClose={() => setModal(false)} onSaved={onSaved} />}

      <div className="subbar"><div className="in">
        <MarketTickers dash={dash} />
        <div className="rt"><div className="rng"><span className="dt">{s ? `${s.first_date} → ${s.last_date}` : ''}</span></div></div>
      </div></div>

      <div className="shell fu">
        <div className="pagehd">
          <div>
            <div className="title">History</div>
          </div>
          <div className="controls">
            <button className="btn" onClick={() => setModal(true)}>＋ Record entry</button>
          </div>
        </div>

        <div className="flt">
          <div className="lsf">
            <button className={filter === 'all' ? 'on' : undefined} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'PAY_IN' ? 'on' : undefined} onClick={() => setFilter('PAY_IN')}>Pay-in</button>
            <button className={filter === 'PAY_OUT' ? 'on' : undefined} onClick={() => setFilter('PAY_OUT')}>Pay-out</button>
          </div>
        </div>

        <div className="kribbon" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          <div className="kr hl"><div className="l">Total Pay-in</div><div className="v">{s ? fAmt(s.total_pay_in_paise) : '…'}</div><div className="s">{s ? `${s.first_date} → ${s.last_date}` : ''}</div></div>
          <div className="kr"><div className="l">Total Pay-out</div><div className="v">{s ? fAmt(s.total_pay_out_paise) : '…'}</div><div className="s">redemptions + fees</div></div>
          <div className="kr hlb"><div className="l">Net Flow</div><div className="v u">{s ? '+' + fAmt(s.net_flow_paise) : '…'}</div><div className="s">pay-in − pay-out</div></div>
          <div className="kr"><div className="l">Closing Balance</div><div className="v">{s ? fAmt(s.closing_paise) : '…'}</div><div className="s">as on {s?.last_date || '—'}</div></div>
        </div>

        <div className="panel">
          <div className="pth"><b>Transaction Ledger</b>
            <span className="ref">{all.length} entries{filter !== 'all' ? ` · ${events.length} ${filter === 'PAY_IN' ? 'pay-in' : 'pay-out'}` : ''}</span>
          </div>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Client Name</th><th>Client Code</th><th>Strategy</th><th>Index</th><th>Type</th>
                  <th className="num">Amount</th><th className="num">Running Balance</th><th>Mode / Ref</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>Loading ledger…</td></tr>}
                {isError && <tr><td colSpan={9} style={{ color: 'var(--neg)' }}>Failed to load ledger.</td></tr>}
                {events.map(e => (
                  <tr key={e.id}>
                    <td>{e.date_disp}</td>
                    <td>{e.client_name}</td>
                    <td className="cc">{e.client_code}</td>
                    <td>{e.strategy}</td>
                    <td>{e.index}</td>
                    <td><span className={'tg2 ' + (e.type === 'PAY_OUT' ? 's' : 'l')}>{e.type === 'PAY_OUT' ? 'PAY-OUT' : 'PAY-IN'}</span></td>
                    <td className={'num m ' + (e.type === 'PAY_OUT' ? 'd' : 'u')}>{fSigned(e.amount_paise, e.type)}</td>
                    <td className="num m">{fAmt(e.running_paise)}</td>
                    <td className="ref">{e.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="note">History · transaction ledger (pay-in / pay-out) · live from capital_events</div>
    </div>
  )
}
