import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { query } from '../db/pg.js'
import { duckQuery, PARQUET } from '../db/duck.js'
import { pairReferenceStats, spotBacktest, spotOpenCycle, SPOT_BACKTEST_BASE_AUM_CR } from '../data/spotBacktest.js'
import { getLiveMarket, readSnapshot } from '../data/liveMarket.js'
import { openCycleMonth, applyOpenCycleToMonthly } from '../data/openCycle.js'

// Live index quotes (NIFTY 50 / MIDCAP SELECT / NIFTY BANK) come from data/liveMarket.js — the
// backend fetches Angel One in-process (60s cache, disk-backed fallback) and marks the open pair
// to the current price on every request. readSnapshot() is the sync last-known fallback.

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

  // Live index quotes (Angel One, 60s cache). Used to mark the open pair + "Today" to the current
  // price. Null-safe: if the fetch fails we fall back to parquet LTP / last trade day below.
  const live = await getLiveMarket().catch(() => null)
  const liveLtp = { NIFTY: live?.nifty?.ltp, MIDCPNIFTY: live?.midcap?.ltp }
  const liveChg = { NIFTY: live?.nifty?.change, MIDCPNIFTY: live?.midcap?.change }
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

  // Open cycle (most-recent-expiry pair): mark it LIVE everywhere. Its Excel exit is a projected
  // close; while the position is held we override the open month in `monthly` with the live MTM
  // (entry-side charges only), so all stats below (total, MoM, yearly, Sharpe, equity) follow it.
  const { rows: latestExpiry } = await query(`SELECT MAX(expiry)::text AS expiry FROM trades`)
  const maxExpiry = latestExpiry[0].expiry
  const { rows: positions } = await query(`
    SELECT
      c.name AS client_name, c.code AS client_code,
      t.underlying, t.contract, t.expiry::text,
      t.direction, t.lots, t.lot_size,
      t.entry_price::float AS entry_price,
      t.exit_price::float  AS exit_price
    FROM trades t
    JOIN clients c ON c.id = t.client_id
    WHERE t.expiry = $1
    ORDER BY c.aum_paise DESC, t.underlying
  `, [maxExpiry])
  applyOpenCycleToMonthly(monthly, maxExpiry.slice(0, 8) + '01', openCycleMonth(positions, u => liveLtp[u]))

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
    SELECT c.code, c.name, c.category, c.exec_type,
           ROUND(aum_paise/1e9::numeric,2) AS aum_cr,
           ROUND(aum_paise*100.0/(SELECT SUM(aum_paise) FROM clients WHERE is_active),1) AS pct,
           ROUND(COALESCE((
             SELECT SUM(COALESCE(NULLIF(cs.exposure_paise, 0), cs.allocation_paise))
             FROM client_strategies cs WHERE cs.client_id=c.id AND cs.is_active=TRUE
           ), c.aum_paise) / 1e9::numeric, 2) AS exposure_cr,
           ROUND(COALESCE((
             SELECT cs.leverage FROM client_strategies cs
             WHERE cs.client_id=c.id AND cs.is_active=TRUE ORDER BY cs.id LIMIT 1
           ), 1), 2) AS leverage
    FROM clients c
    WHERE c.is_active = TRUE
    ORDER BY aum_paise DESC
  `)

  // 5. Positions (open pair) + maxExpiry were fetched above (used for the live open-cycle override).

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

  // Enrich positions with live LTP-based unrealised.
  // Price priority: live Angel One index quote → parquet continuous close → trade exit price.
  const enrichedPos = positions.map(p => {
    const ltp     = liveLtp[p.underlying] ?? ltpByUnderlying[p.underlying] ?? +p.exit_price
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

  // Margin blocked = open-pair notional at the LIVE price × SPAN+exposure rate (~12% for index
  // futures; MIDCPNIFTY and NIFTY are different underlyings → margined separately, no hedge benefit).
  // Moves with today's live rate. Computed at 30 Cr base; the client scales it to displayed AUM.
  const MARGIN_RATE = 0.12
  const grossNotionalInr = enrichedPos.reduce((s, p) => s + p.ltp * p.lots * p.lot_size, 0)
  const marginUsedInr = grossNotionalInr * MARGIN_RATE

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

  // "Today" = the open pair marked to today's LIVE intraday move (Angel One day-change × qty, signed
  // by leg direction). Real calendar date, updates every minute with the price. Falls back to the
  // last actual trade day in the DB only when no live quote is available.
  const istToday    = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)  // IST date
  const haveLiveChg = positions.some(p => liveChg[p.underlying] != null)
  let todayDayStr, todayNetInr, todayTrades
  if (haveLiveChg) {
    todayNetInr = positions.reduce((s, p) => {
      const chg = liveChg[p.underlying]
      if (chg == null) return s
      const qty = p.lots * p.lot_size
      return s + (p.direction === 'LONG' ? chg : -chg) * qty
    }, 0)
    todayDayStr = (live?.updated || istToday).slice(0, 10)
    todayTrades = positions.length
  } else {
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
    const lastDay = lastDayRows[0] || null
    todayDayStr   = lastDay ? lastDay.d : istToday
    todayNetInr   = lastDay ? +lastDay.net : 0
    todayTrades   = lastDay ? +lastDay.trades : 0
  }

  // Charge pie splits (pct of total)
  const chTotal = +ch.total || 1
  const chargePie = {
    stt:       +(+ch.stt  / chTotal * 100).toFixed(1),
    stamp_sebi:+(((+ch.stamp)+(+ch.sebi)) / chTotal * 100).toFixed(1),
    exch_gst:  +(((+ch.exch)+(+ch.gst))   / chTotal * 100).toFixed(1),
  }

  // Spot backtest: append the OPEN cycle (blank exit in the sheet) marked to the LIVE SPOT LTP
  // (NIFTY MIDCAP SELECT / NIFTY 50), entry-side charges only — same treatment as the fut open cycle.
  // Falls back to the entry price (0 P&L) when live spot is unavailable.
  const spotLtp = { MIDCPNIFTY: live?.midcap?.spot?.ltp, NIFTY: live?.nifty?.spot?.ltp }
  const spotEntry = Object.fromEntries(spotOpenCycle.legs.map(l => [l.underlying, l.entry_price]))
  const spotOpen = openCycleMonth(spotOpenCycle.legs, u => spotLtp[u] ?? spotEntry[u])
  const spotSeries = [...spotBacktest, {
    date: spotOpenCycle.month,
    net_inr: Math.round(spotOpen.net_inr),
    midcap_net_inr: Math.round(spotOpen.midcap_net_inr),
    nifty_net_inr: Math.round(spotOpen.nifty_net_inr),
  }]

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
        net_inr:        Math.round(todayNetInr),
        realised_inr:   haveLiveChg ? 0 : Math.round(todayNetInr),
        unrealised_inr: haveLiveChg ? Math.round(todayNetInr) : 0,
        date:           todayDayStr,
        trades:         todayTrades,
        live:           haveLiveChg,
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
    margin: {
      notional_inr: Math.round(grossNotionalInr),   // open-pair gross notional at live price (30 Cr base)
      rate:         MARGIN_RATE,
      used_inr:     Math.round(marginUsedInr),       // margin blocked at today's rate (30 Cr base)
      live:         Object.values(liveLtp).some(v => v != null),
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
      series: spotSeries,
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
      name:      c.name,
      code:      c.code,
      category:  c.category,
      exec_type: c.exec_type || 'F2F',   // F2F = fut×fut · F2O = fut×option (drives the Fut/Options card filter)
      aum_cr:    +c.aum_cr,
      exposure_cr: +c.exposure_cr,
      leverage:  +c.leverage,
      pct:       +c.pct,
    })),
    positions: enrichedPos,
    rollover: {
      flag:    1,
      expiry:  rolloverExpiry,
      label:   new Date(rolloverExpiry).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}).replace(/ /g,' '),
    },
    latest_date: maxExpiry,     // last realised cycle (data end) — drives the showcase range + chart end.
                                // The real calendar date lives on hero.today.date (live).
    tickers: live || readSnapshot(),  // live NIFTY 50 / MIDCAP SELECT / NIFTY BANK (Angel One)
  }
}
