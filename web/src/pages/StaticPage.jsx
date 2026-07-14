// Renders a static mockup page's markup, scoped under .pg-<name> so its CSS can't leak.
// The mockups ship a HARDCODED ticker subbar (stale prices); we strip it and render a LIVE
// market ticker bar (NIFTY 50 / MIDCAP SELECT / NIFTY BANK) so it matches the other pages.
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import MarketTickers from '../components/MarketTickers'

export default function StaticPage({ name, html }) {
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet('/api/dashboard') })
  // Drop the mockup's static subbar; keep everything from the shell onward.
  const shellIdx = html.indexOf('<div class="shell')
  const body = shellIdx >= 0 ? html.slice(shellIdx) : html
  return (
    <div className={`pg-${name}`}>
      <div className="subbar"><div className="in">
        <MarketTickers dash={dash} />
        <div className="ti"><span className="n">Data as of</span><span className="v">{dash?.latest_date || '—'}</span></div>
      </div></div>
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  )
}
