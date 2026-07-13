// Renders a static mockup page's markup, scoped under .pg-<name> so its CSS can't leak.
// The mockups ship a HARDCODED ticker subbar (stale NIFTY/MIDCAP prices); we strip it and
// render a LIVE ticker bar from /api/dashboard so it matches the Dashboard/Strategies/Clients.
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import { fmtNum } from '../lib/format'

function Ticker({ name, p }) {
  const up = p ? p.points >= 0 : true
  return (
    <div className="ti"><span className="n">{name}</span><span className="v">{p ? fmtNum(p.ltp) : '—'}</span>
      {p && <span className={'c ' + (up ? 'u' : 'd')}>{(up ? '▲' : '▼') + Math.abs(p.points).toFixed(2)}</span>}</div>
  )
}

export default function StaticPage({ name, html }) {
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })
  const nifty = dash?.positions?.find(p => p.underlying === 'NIFTY')
  const mid = dash?.positions?.find(p => p.underlying === 'MIDCPNIFTY')
  // Drop the mockup's static subbar; keep everything from the shell onward.
  const shellIdx = html.indexOf('<div class="shell')
  const body = shellIdx >= 0 ? html.slice(shellIdx) : html
  return (
    <div className={`pg-${name}`}>
      <div className="subbar"><div className="in">
        <Ticker name="NIFTY 50" p={nifty} />
        <Ticker name="MIDCAP SELECT" p={mid} />
        <div className="ti"><span className="n">Data as of</span><span className="v">{dash?.latest_date || '—'}</span></div>
      </div></div>
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  )
}
