// Per-client real-lot quantity model. The 30 Cr master book (`trades`) stores only a rolled QUANTITY
// (lots × lot_size), sized to ~30 Cr notional and held across expiries — it changes only at genuine
// close+reopen "re-entries". To size a client, we scale that quantity by exposure/30 AT EACH RE-ENTRY,
// round to a whole number of REAL NSE lots (lot size keyed to that contract's EXPIRY date), then roll
// the rounded quantity unchanged until the next re-entry. PnL/charges/margin all follow the rounded qty.
// Real lot-size schedule + the expiry-keyed rule: see memory pairtrading-lot-sizes.md.

import { DEFAULT_LOT_SIZE_HISTORY, lotSizeFromHistory } from './lotSizeHistory.js'

// Real NSE lot size (qty per 1 lot) for a symbol, chosen by the CONTRACT's EXPIRY date.
export function lotSize(underlying, expiryISO, history = DEFAULT_LOT_SIZE_HISTORY) {
  return lotSizeFromHistory(history, underlying, expiryISO)
}

// Nearest whole number of lots (ties → half-up), floored to a 1-lot minimum.
export function roundToLot(rawQty, lot) {
  return Math.max(1, Math.round(rawQty / lot)) * lot
}

// baseLegs: the full 30 Cr master book, each leg:
//   { id, trade_date, underlying, contract, expiry, direction, base_qty, entry, exit, regime,
//     gross (₹ @30Cr, unused), stt, exch, sebi, stamp, gst, charges }   (₹, round-trip @30Cr)
// opts: { scaleAt, joinDate|null, maxExpiry, openBase, liveLtp }
//   scaleAt: (tradeDateISO) => exposure/30 in force at that date (capital timeline). A plain number is
//   accepted too (constant scale) for callers with a single, unchanging capital.
// Returns { monthly, recent, positions, charges } all driven by the rounded per-client quantities.
export function buildClientBook(baseLegs, { scaleAt, joinDate, maxExpiry, openBase, liveLtp, lotHistory = DEFAULT_LOT_SIZE_HISTORY }) {
  const scaleFn = typeof scaleAt === 'function' ? scaleAt : () => scaleAt
  // 1. Per-symbol: segment by consecutive equal base_qty (a "position" held across rolls). At each
  //    segment start (= a re-entry) size the client's whole-lot quantity using the scale (exposure/30)
  //    in force AT THE RE-ENTRY DATE, then hold it across the segment. A capital change mid-hold takes
  //    effect at the next re-entry — a position already open isn't resized (trade-cycle boundary).
  const qtyById = new Map()   // leg.id -> { cQty, lot }
  for (const sym of ['MIDCPNIFTY', 'NIFTY']) {
    const legs = baseLegs.filter(l => l.underlying === sym).sort((a, b) => (a.expiry < b.expiry ? -1 : 1))
    let i = 0
    while (i < legs.length) {
      const baseQty = legs[i].base_qty
      const lot = lotSize(sym, legs[i].expiry, lotHistory) // lot size at the RE-ENTRY contract's expiry
      // A client who JOINED mid-segment (this position opened before they had capital) must be sized at
      // their join, not the pre-join re-entry — else scaleAt=0 wrongly floors the whole segment to 1 lot.
      const sizeDate = (joinDate && legs[i].trade_date < joinDate) ? joinDate : legs[i].trade_date
      const cQty = roundToLot(scaleFn(sizeDate) * baseQty, lot)
      let j = i
      while (j < legs.length && legs[j].base_qty === baseQty) { qtyById.set(legs[j].id, { cQty, lot }); j++ }
      i = j
    }
  }

  // 2. Per-leg client values (gross/charges/net), live-marking the open cycle (entry-side charges only).
  const legs = baseLegs
    .filter(l => !joinDate || l.trade_date >= joinDate)
    .map(l => {
      // Fallback (defensive): a leg outside the NIFTY/MIDCAP schedule keeps its sheet qty, scaled linearly.
      const { cQty, lot } = qtyById.get(l.id) || { cQty: Math.round(scaleFn(l.trade_date) * l.base_qty), lot: l.base_qty }
      const f = cQty / l.base_qty                        // linear scale for this leg's ₹ amounts
      const isOpen = l.expiry === maxExpiry
      let gross, charges, net, exit
      if (isOpen) {
        const ob = l.underlying === 'MIDCPNIFTY'
          ? { g: openBase.midcap_gross_inr, n: openBase.midcap_net_inr }
          : { g: openBase.nifty_gross_inr, n: openBase.nifty_net_inr }
        gross = ob.g * f; net = ob.n * f; charges = gross - net
        exit = liveLtp?.[l.underlying] ?? l.exit
      } else {
        gross = (l.direction === 'LONG' ? l.exit - l.entry : l.entry - l.exit) * cQty
        charges = l.charges * f
        net = gross - charges
        exit = l.exit
      }
      return {
        id: l.id, trade_date: l.trade_date, expiry: l.expiry, month: l.expiry.slice(0, 7) + '-01',
        underlying: l.underlying, contract: l.contract, direction: l.direction, regime: l.regime,
        entry: l.entry, exit, lot, cQty, isOpen,
        gross, net, charges,
        stt: l.stt * f, exch_c: l.exch * f, sebi: l.sebi * f, stamp: l.stamp * f, gst: l.gst * f,
      }
    })

  // 3. Combined P/L per pair (= both legs' net within an expiry month, over the client's window).
  const combinedByMonth = {}
  for (const g of legs) combinedByMonth[g.month] = (combinedByMonth[g.month] || 0) + g.net

  // 4. Monthly series (by expiry month) + running cumulative.
  const months = [...new Set(legs.map(g => g.month))].sort()
  let cum = 0
  const monthly = months.map(month => {
    const rows = legs.filter(g => g.month === month)
    const gross = rows.reduce((s, g) => s + g.gross, 0)
    const charges = rows.reduce((s, g) => s + g.charges, 0)
    const net = gross - charges
    cum += net
    const midcap_net_inr = rows.filter(g => g.underlying === 'MIDCPNIFTY').reduce((s, g) => s + g.net, 0)
    const nifty_net_inr = rows.filter(g => g.underlying === 'NIFTY').reduce((s, g) => s + g.net, 0)
    return { month, gross_inr: gross, charges_inr: charges, net_inr: net, cumulative_inr: cum, midcap_net_inr, nifty_net_inr }
  })

  // 5. Recent trades (latest expiry first, then underlying) with combined merged per pair.
  const recent = [...legs]
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : (a.underlying < b.underlying ? -1 : 1)))
    .map(g => ({ ...g, combined_pl_inr: combinedByMonth[g.month] }))

  // 6. Open positions (latest expiry).
  const positions = legs.filter(g => g.expiry === maxExpiry)

  // 7. Lifetime charges (round-trip @ client qty, like the pre-existing footer).
  const sum = (k) => legs.reduce((s, g) => s + g[k], 0)
  const charges = { total: sum('charges'), stt: sum('stt'), exch: sum('exch_c'), sebi: sum('sebi'), stamp: sum('stamp'), gst: sum('gst') }

  return { monthly, recent, positions, charges }
}
