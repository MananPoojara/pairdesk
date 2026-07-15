// Shared market ticker chips: NIFTY 50 / MIDCAP SELECT / NIFTY BANK.
// Self-polls /api/tickers every 60s for live Angel One EOD; falls back to the futures LTP.
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import { fmtNum } from '../lib/format'

function Ticker({ name, t, fallback }) {
  const ltp = t?.ltp ?? fallback?.ltp
  const chg = t?.change ?? fallback?.points
  if (ltp == null) return <div className="ti"><span className="n">{name}</span><span className="v">—</span></div>
  const up = (chg ?? 0) >= 0
  return (
    <div className="ti"><span className="n">{name}</span><span className="v">{fmtNum(ltp)}</span>
      {chg != null && <span className={'c ' + (up ? 'u' : 'd')}>{(up ? '▲' : '▼') + Math.abs(chg).toFixed(2)}</span>}</div>
  )
}

export default function MarketTickers({ dash }) {
  const { data: tk } = useQuery({
    queryKey: ['tickers'],
    queryFn: () => apiGet('/api/tickers'),
    refetchInterval: () => 62000 - (Date.now() % 60000),  // align to ~:02 each minute (just after the backend's :00 close-fetch)
    refetchIntervalInBackground: true,  // keep polling even when the tab isn't focused
    refetchOnWindowFocus: true,
    staleTime: 0,                        // always treat as stale so the interval never no-ops
  })
  const t = tk || {}
  const niftyPos = dash?.positions?.find(p => p.underlying === 'NIFTY')
  const midPos = dash?.positions?.find(p => p.underlying === 'MIDCPNIFTY')
  return (
    <>
      <Ticker name="NIFTY FUT" t={t.nifty} fallback={niftyPos} />
      <Ticker name="MIDCAP FUT" t={t.midcap} fallback={midPos} />
      <Ticker name="BANKNIFTY FUT" t={t.banknifty} />
    </>
  )
}
