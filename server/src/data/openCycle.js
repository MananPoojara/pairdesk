// Live mark-to-market for the OPEN cycle (the most-recent-expiry pair). Its Excel `exit_price` is a
// projected close; while the position is still held we mark it to the live futures LTP and count
// only ENTRY-side charges (the exit hasn't happened yet). Everything is at the 30 Cr blueprint base;
// callers override the open cycle's month in their monthly[] series and apply their own scale.

import { getRates } from './chargeConfig.js'

// FUTURES charge rates — Admin-editable (see chargeConfig.js), defaults match Data/ingest_pnl.py.
// The open cycle is always the latest → traded after the 2026-03-01 STT change, so the current STT
// rate applies.

// Entry-side charges only. Entry is a BUY for a LONG leg (exchange + SEBI + stamp + GST, no STT —
// STT is sell-side) and a SELL for a SHORT leg (STT + exchange + SEBI + GST, no stamp — stamp is
// buy-side). Turnover for a single leg = its entry notional (qty × entry).
function entryCharges(direction, notional) {
  const R = getRates()
  const exch = notional * R.exch
  const sebi = notional * R.sebi
  const gst = (exch + sebi) * R.gst
  const isBuy = direction === 'LONG'
  const stt = isBuy ? 0 : notional * R.stt
  const stamp = isBuy ? notional * R.stamp : 0
  return stt + exch + sebi + stamp + gst
}

// legs: [{ underlying, direction, entry_price, exit_price, lots, lot_size }] (the open pair from DB).
// priceFor(underlying) → live LTP (caller resolves live → tickers.json snapshot); the Excel
// exit_price is the final fallback here. Returns the open cycle's month P&L at the 30 Cr base.
export function openCycleMonth(legs, priceFor) {
  let gross = 0, charges = 0, midGross = 0, midCh = 0, nifGross = 0, nifCh = 0
  for (const p of legs) {
    const qty = p.lots * p.lot_size
    const entry = +p.entry_price
    const live = priceFor(p.underlying) ?? +p.exit_price
    const g = (p.direction === 'LONG' ? live - entry : entry - live) * qty
    const c = entryCharges(p.direction, qty * entry)
    gross += g; charges += c
    if (p.underlying === 'MIDCPNIFTY') { midGross += g; midCh += c }
    else if (p.underlying === 'NIFTY') { nifGross += g; nifCh += c }
  }
  return {
    gross_inr: gross, charges_inr: charges, net_inr: gross - charges,
    midcap_gross_inr: midGross, midcap_net_inr: midGross - midCh,
    nifty_gross_inr: nifGross, nifty_net_inr: nifGross - nifCh,
  }
}

// Override the open cycle's month (openMonthISO = 'YYYY-MM-01') in a monthly[] series with the live
// values (× scale) and recompute the running cumulative_inr so all downstream stats follow. Mutates
// and returns `monthly`. Fields not present on a row are simply set.
export function applyOpenCycleToMonthly(monthly, openMonthISO, ov, scale = 1) {
  for (const m of monthly) {
    if (m.month !== openMonthISO) continue
    m.gross_inr = ov.gross_inr * scale
    m.charges_inr = ov.charges_inr * scale
    m.net_inr = ov.net_inr * scale
    m.midcap_gross_inr = ov.midcap_gross_inr * scale
    m.midcap_net_inr = ov.midcap_net_inr * scale
    m.nifty_gross_inr = ov.nifty_gross_inr * scale
    m.nifty_net_inr = ov.nifty_net_inr * scale
  }
  let cum = 0
  for (const m of monthly) { cum += +m.net_inr; m.cumulative_inr = cum }
  return monthly
}
