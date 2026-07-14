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
    refetchInterval: 60000,        // live-refresh every minute
    refetchOnWindowFocus: true,
  })
  const t = tk || {}
  const niftyPos = dash?.positions?.find(p => p.underlying === 'NIFTY')
  const midPos = dash?.positions?.find(p => p.underlying === 'MIDCPNIFTY')
  return (
    <>
      <Ticker name="NIFTY 50" t={t.nifty} fallback={niftyPos} />
      <Ticker name="MIDCAP SELECT" t={t.midcap} fallback={midPos} />
      <Ticker name="NIFTY BANK" t={t.banknifty} />
    </>
  )
}
