import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { query } from '../db/pg.js'
import { duckQuery, PARQUET } from '../db/duck.js'
import { pairReferenceStats, spotBacktest, SPOT_BACKTEST_BASE_AUM_CR } from '../data/spotBacktest.js'

// Live index tickers (NIFTY 50 / MIDCAP SELECT / NIFTY BANK) from Angel One EOD, refreshed by
// `python3 Data/fetch_tickers.py`. Read per-request so a re-run updates without a server restart.
const TICKERS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../data/tickers.json')
export function readTickers() {
  try { return JSON.parse(readFileSync(TICKERS_PATH, 'utf8')) } catch { return null }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtCr  = n => Math.round(n * 100) / 100   // 2dp Cr
const paise  = n => Math.round(n * 100)          // rupees → paise (int)

function sharpe(monthlyNets, aumInr) {
  if (monthlyNets.length < 2) return 0
  const pcts = monthlyNets.map(n => n / aumInr * 100)
  const mean = pcts.reduce((a,b)=>a+b,0) / pcts.length
  const std  = Math.sqrt(pcts.map(p=>(p-mean)**2).reduce((a,b)=>a+b,0)/(pcts.length-1))
  return std === 0 ? 0 : +((mean / std * Math.sqrt(12)).toFixed(2))
}

// 1 Cr = 1e7 INR = 1e9 paise

function maxDrawdown(cumulative) {
  let peak = 0, maxDD = 0
  for (const v of cumulative) {
    if (v > peak) peak = v
    const dd = peak === 0 ? 0 : (peak - v) / peak
    if (dd > maxDD) maxDD = dd
  }
  return +(maxDD * 100).toFixed(2)
}

// ── main handler ──────────────────────────────────────────────────────────────
export async function dashboardHandler(req, reply) {

  // 0. Total AUM from DB (sum of active clients)
  const { rows: aumRow } = await query(`
    SELECT COALESCE(SUM(aum_paise),0)::float AS total_paise
    FROM clients WHERE is_active = TRUE
  `)
  const AUM_PAISE = aumRow[0].total_paise
  const AUM_INR   = AUM_PAISE / 100          // rupees  (total platform AUM — for book display only)
  const AUM_CR    = AUM_PAISE / 1e9          // crores  (total platform AUM — for book display only)
  // Trades are calibrated to 30 Cr deployment — use this for all % calculations (pct, sharpe, return_pct)
  const BASE_CR   = 30
  const BASE_INR  = BASE_CR * 1e7

  // 1. Monthly P&L — sum across ALL clients = platform total
  const { rows: monthly } = await query(`
    WITH m AS (
      SELECT
        -- Book each cycle's P&L in its EXPIRY month (when it's realised), not the entry month —
        -- so the May-entry / June-expiry cycle shows up as June.
        to_char(date_trunc('month', t.expiry), 'YYYY-MM-01') AS month,
        COUNT(*) AS trades,
        SUM(
          CASE WHEN t.direction='LONG'
               THEN (t.exit_price  - t.entry_price) * t.lots * t.lot_size
               ELSE (t.entry_price - t.exit_price)  * t.lots * t.lot_size
          END
        )                        AS gross_inr,
        SUM(CASE WHEN t.underlying='MIDCPNIFTY' THEN
          CASE WHEN t.direction='LONG'
               THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
               ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size
          END ELSE 0 END) AS midcap_gross_inr,
        SUM(CASE WHEN t.underlying='NIFTY' THEN
          CASE WHEN t.direction='LONG'
               THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
               ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size
          END ELSE 0 END) AS nifty_gross_inr,
        SUM(tc.total_paise)/100.0 AS charges_inr,
        SUM(CASE WHEN t.underlying='MIDCPNIFTY' THEN tc.total_paise ELSE 0 END)/100.0 AS midcap_charges_inr,
        SUM(CASE WHEN t.underlying='NIFTY' THEN tc.total_paise ELSE 0 END)/100.0 AS nifty_charges_inr,
        SUM(tc.stt_paise   )/100.0 AS stt_inr,
        SUM(tc.exchange_paise)/100.0 AS exch_inr,
        SUM(tc.sebi_paise  )/100.0 AS sebi_inr,
        SUM(tc.stamp_paise )/100.0 AS stamp_inr,
        SUM(tc.gst_paise   )/100.0 AS gst_inr
      FROM trades t
      JOIN trade_charges tc ON tc.trade_id = t.id
      GROUP BY month
      ORDER BY month
    )
    SELECT *,
      gross_inr - charges_inr AS net_inr,
      midcap_gross_inr - midcap_charges_inr AS midcap_net_inr,
      nifty_gross_inr - nifty_charges_inr AS nifty_net_inr,
      SUM(gross_inr - charges_inr) OVER (ORDER BY month) AS cumulative_inr
    FROM m
  `)

  // 2. Charge totals (lifetime)
  const { rows: chargeTot } = await query(`
    SELECT
      SUM(stt_paise   )/100.0 AS stt,
      SUM(exchange_paise)/100.0 AS exch,
      SUM(sebi_paise  )/100.0 AS sebi,
      SUM(stamp_paise )/100.0 AS stamp,
      SUM(gst_paise   )/100.0 AS gst,
      SUM(total_paise )/100.0 AS total
    FROM trade_charges
  `)
  const ch = chargeTot[0]

  // 3. Win rate (months with positive net)
  const wins      = monthly.filter(m => +m.net_inr > 0).length
  const winRate   = monthly.length ? +(wins / monthly.length * 100).toFixed(1) : 0
  const netByMonth= monthly.map(m => +m.net_inr)
  const cumArr    = monthly.map(m => +m.cumulative_inr)
  const bestMonth = Math.max(...netByMonth)
  const worstMo   = Math.min(...netByMonth)
  const totalNet  = cumArr[cumArr.length - 1] || 0
  const sr        = sharpe(netByMonth, BASE_INR)
  const maxDD     = pairReferenceStats.max_dd_pct || maxDrawdown(cumArr)

  // 4. Client breakdown
  const { rows: clients } = await query(`
    SELECT code, name, category,
           ROUND(aum_paise/1e9::numeric,2) AS aum_cr,
           ROUND(aum_paise*100.0/(SELECT SUM(aum_paise) FROM clients WHERE is_active),1) AS pct
    FROM clients
    WHERE is_active = TRUE
    ORDER BY aum_paise DESC
  `)

  // 5. Positions — most recent expiry (= currently open pair)
  const { rows: latestExpiry } = await query(`
    SELECT MAX(expiry)::text AS expiry FROM trades
  `)
  const maxExpiry = latestExpiry[0].expiry

  const { rows: positions } = await query(`
    SELECT
      c.name AS client_name, c.code AS client_code,
      t.underlying, t.contract, t.expiry::text,
      t.direction, t.lots, t.lot_size,
      t.entry_price::float AS entry_price,
      t.exit_price::float  AS exit_price,
      CASE WHEN t.direction='LONG'
           THEN (t.exit_price - t.entry_price) * t.lots * t.lot_size
           ELSE (t.entry_price - t.exit_price) * t.lots * t.lot_size
      END AS pnl_inr
    FROM trades t
    JOIN clients c ON c.id = t.client_id
    WHERE t.expiry = $1
    ORDER BY c.aum_paise DESC, t.underlying
  `, [maxExpiry])

  // 6. LTP + latest_date from DuckDB
  // Use fut_continuous (goes to 2026-06-18) for the most recent prices.
  // Map by underlying since continuous contracts don't match fut_bars contract names.
  const underlyings = [...new Set(positions.map(p => p.underlying))]
  let ltpByUnderlying = {}
  let latestPriceDate = null
  if (underlyings.length) {
    const inList = underlyings.map(u => `'${u}'`).join(',')
    const ltpRows = await duckQuery(`
      SELECT underlying,
             arg_max(close, datetime) AS ltp,
             max(date)::TEXT          AS last_date
      FROM read_parquet('${PARQUET.cont}')
      WHERE underlying IN (${inList})
      GROUP BY underlying
    `)
    ltpRows.forEach(r => {
      ltpByUnderlying[r.underlying] = +r.ltp
      if (!latestPriceDate || r.last_date > latestPriceDate) latestPriceDate = r.last_date
    })
  }

  // Enrich positions with live LTP-based unrealised
  const enrichedPos = positions.map(p => {
    const ltp     = ltpByUnderlying[p.underlying] ?? +p.exit_price
    const qty     = p.lots * p.lot_size
    const points  = p.direction === 'LONG' ? ltp - +p.entry_price : +p.entry_price - ltp
    const unreal  = points * qty
    return {
      client:       p.client_name,
      client_code:  p.client_code,
      symbol:       p.contract,
      underlying:   p.underlying,
      expiry:       p.expiry,
      direction:    p.direction,
      lots:         p.lots,
      lot_size:     p.lot_size,
      entry_price:  +p.entry_price,
      ltp:          +ltp.toFixed(2),
      points:       +points.toFixed(2),
      unrealised_inr: Math.round(unreal),
    }
  })

  // 7. Rollover tile — next expiry after max
  const { rows: nextExp } = await query(`
    SELECT DISTINCT expiry::text
    FROM trades
    ORDER BY expiry DESC
    LIMIT 2
  `)
  const rolloverExpiry = nextExp[0]?.expiry ?? maxExpiry

  // 8. Hero numbers
  const totalNetCr      = totalNet / 1e7
  const totalReturnPct  = +(totalNet / BASE_INR * 100).toFixed(2)
  const bestMonthPct    = +(bestMonth / BASE_INR * 100).toFixed(2)
  const worstMoPct      = +(worstMo   / BASE_INR * 100).toFixed(2)

  // latest_date = last date we have prices (fut_continuous → 2026-06-18), used for LTP/ticker.
  const todayStr = latestPriceDate ?? maxExpiry   // e.g. "2026-06-18"

  // "Today" PnL = the last actual TRADE day in the DB (monthly rollover → e.g. 2026-05-26).
  // We show historical results "as if live", so Today reflects the most recent day we have data for.
  const { rows: lastDayRows } = await query(`
    SELECT t.trade_date::text AS d,
           (SUM(CASE WHEN t.direction='LONG'
                     THEN (t.exit_price-t.entry_price)*t.lots*t.lot_size
                     ELSE (t.entry_price-t.exit_price)*t.lots*t.lot_size END)
            - COALESCE(SUM(tc.total_paise),0)/100.0)::float AS net,
           COUNT(*)::int AS trades
    FROM trades t
    JOIN trade_charges tc ON tc.trade_id = t.id
    GROUP BY t.trade_date
    ORDER BY t.trade_date DESC
    LIMIT 1
  `)
  const lastDay      = lastDayRows[0] || null
  const todayDayStr  = lastDay ? lastDay.d : todayStr
  const todayNetInr  = lastDay ? +lastDay.net : 0
  const todayTrades  = lastDay ? +lastDay.trades : 0

  // Charge pie splits (pct of total)
  const chTotal = +ch.total || 1
  const chargePie = {
    stt:       +(+ch.stt  / chTotal * 100).toFixed(1),
    stamp_sebi:+(((+ch.stamp)+(+ch.sebi)) / chTotal * 100).toFixed(1),
    exch_gst:  +(((+ch.exch)+(+ch.gst))   / chTotal * 100).toFixed(1),
  }

  return {
    hero: {
      overall: {
        net_inr:      Math.round(totalNet),
        net_cr:       +totalNetCr.toFixed(2),
        realised_inr: Math.round(totalNet),   // all realised (all trades closed)
        unrealised_inr: 0,
        return_pct:   totalReturnPct,
        since:        '26 Sep 2024',
      },
      today: {
        net_inr:      Math.round(todayNetInr),
        realised_inr: Math.round(todayNetInr),
        unrealised_inr: 0,
        date:         todayDayStr,
        trades:       todayTrades,
      }
    },
    book: {
      aum_cr:      +AUM_CR.toFixed(2),
      base_aum_cr: BASE_CR,
      exposure_cr: +AUM_CR.toFixed(2),
      leverage:    1.00,
      clients:     clients.length,
      strategies:  1,
    },
    stats: {
      sharpe:          sr,
      win_rate:        winRate,
      wins,
      total_months:    monthly.length,
      best_month_inr:  Math.round(bestMonth),
      best_month_pct:  bestMonthPct,
      worst_month_inr: Math.round(worstMo),
      worst_month_pct: worstMoPct,
      max_dd_pct:      maxDD,
      pair_max_dd_pct: maxDD,
      total_net_inr:   Math.round(totalNet),
    },
    monthly: monthly.map(m => ({
      month:          m.month,
      gross_inr:      Math.round(+m.gross_inr),
      charges_inr:    Math.round(+m.charges_inr),
      trades:         +m.trades,
      net_inr:        Math.round(+m.net_inr),
      midcap_net_inr: Math.round(+m.midcap_net_inr),
      nifty_net_inr:  Math.round(+m.nifty_net_inr),
      cumulative_inr: Math.round(+m.cumulative_inr),
      pct:            +(+m.net_inr / BASE_INR * 100).toFixed(3),
      midcap_pct:     +(+m.midcap_net_inr / BASE_INR * 100).toFixed(3),
      nifty_pct:      +(+m.nifty_net_inr / BASE_INR * 100).toFixed(3),
    })),
    backtest: {
      source: 'Data/SpotData',
      basis: 'spot',
      base_aum_cr: SPOT_BACKTEST_BASE_AUM_CR,
      series: spotBacktest,
    },
    charges: {
      total_inr:  Math.round(+ch.total),
      total_cr:   +(+ch.total / 1e7).toFixed(2),
      stt_inr:    Math.round(+ch.stt),
      exch_inr:   Math.round(+ch.exch),
      sebi_inr:   Math.round(+ch.sebi),
      stamp_inr:  Math.round(+ch.stamp),
      gst_inr:    Math.round(+ch.gst),
      pie:        chargePie,
    },
    clients: clients.map(c => ({
      name:     c.name,
      code:     c.code,
      category: c.category,
      aum_cr:   +c.aum_cr,
      pct:      +c.pct,
    })),
    positions: enrichedPos,
    rollover: {
      flag:    1,
      expiry:  rolloverExpiry,
      label:   new Date(rolloverExpiry).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}).replace(/ /g,' '),
    },
    latest_date: todayDayStr,   // last actual TRADE day (e.g. 2026-06-30), for the subtitle + chart end
    tickers: readTickers(),     // live NIFTY 50 / MIDCAP SELECT / NIFTY BANK EOD (Angel One)
  }
}
