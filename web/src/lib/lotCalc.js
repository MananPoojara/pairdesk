// Frontend mirror of server/src/data/lotCalc.js, for the BankNifty variant — its 30 Cr base trades live
// in variantTrades.js (not the DB), so the same real-lot rounding + roll model runs client-side here.
// Keep the lot-size schedule in sync with the server copy. See memory pairtrading-lot-sizes.md.

const DEFAULT_HISTORY = [
  { underlying: 'NIFTY', effective_date: '1900-01-01', lot_size: 25 },
  { underlying: 'NIFTY', effective_date: '2024-11-20', lot_size: 75 },
  { underlying: 'NIFTY', effective_date: '2025-12-30', lot_size: 65 },
  { underlying: 'MIDCPNIFTY', effective_date: '1900-01-01', lot_size: 50 },
  { underlying: 'MIDCPNIFTY', effective_date: '2024-11-20', lot_size: 120 },
  { underlying: 'MIDCPNIFTY', effective_date: '2025-04-25', lot_size: 140 },
  { underlying: 'MIDCPNIFTY', effective_date: '2025-10-28', lot_size: 120 },
]

// Real NSE lot size (qty per lot), keyed by the CONTRACT's EXPIRY date.
export function lotSize(underlying, expiryISO, history = DEFAULT_HISTORY) {
  const date = String(expiryISO).slice(0, 10)
  const rows = history.filter(row => row.underlying === underlying && String(row.effective_date).slice(0, 10) <= date)
    .sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)))
  return Number(rows[rows.length - 1]?.lot_size || 1)
}

// Nearest whole lots (ties → half-up), floored to a 1-lot minimum.
export function roundToLot(rawQty, lot) { return Math.max(1, Math.round(rawQty / lot)) * lot }

// Entry-side-only futures charges for the open cycle (mirrors server/src/data/openCycle.js). `rates`
// (Admin-editable, fetched from GET /api/charge-config) defaults to the historical hardcoded values.
export const DEFAULT_CHARGE_RATES = { exch: 0.0000173, sebi: 0.000001, stamp: 0.0002, gst: 0.18, stt: 0.0005 }
export function futEntryCharges(direction, notional, rates = DEFAULT_CHARGE_RATES) {
  const exch = notional * rates.exch, sebi = notional * rates.sebi, gst = (exch + sebi) * rates.gst
  const isBuy = direction === 'LONG'
  return (isBuy ? 0 : notional * rates.stt) + exch + sebi + (isBuy ? notional * rates.stamp : 0) + gst
}

// baseTrades: BankNifty 30 Cr book — [{ underlying, expiry, direction, lots, lot_size, entry, exit,
//   net_inr, combined_pl_inr }]. opts: { scaleAt, capitalAt, joinFloor:'YYYY-MM-01'|null, liveLtp, maxExpiry }.
//   scaleAt: (tradeDateISO)=>exposure/30 in force (fn or number); capitalAt: (dateISO)=>capital Cr (for
//   the per-month return base). Both driven by the client's pay-in/pay-out timeline; a number = constant.
// Returns { monthly, trades } driven by rounded real-lot quantities (open cycle marked to live LTP).
export function clientVariantBook(baseTrades, { scaleAt, capitalAt, joinFloor, liveLtp, maxExpiry, lotHistory = DEFAULT_HISTORY, rates = DEFAULT_CHARGE_RATES }) {
  const scaleFn = typeof scaleAt === 'function' ? scaleAt : () => scaleAt
  const capFn = typeof capitalAt === 'function' ? capitalAt : null
  // Per-symbol segmentation by consecutive equal base qty (a position held across rolls). The scale is
  // taken at the re-entry date, so a capital change steps the lots from that trade-cycle forward.
  const qtyByIdx = new Map()
  for (const sym of ['MIDCPNIFTY', 'NIFTY']) {
    const rows = baseTrades.map((t, i) => ({ t, i })).filter(x => x.t.underlying === sym)
      .sort((a, b) => (a.t.expiry < b.t.expiry ? -1 : 1))
    let k = 0
    while (k < rows.length) {
      const baseQty = rows[k].t.lots * rows[k].t.lot_size
      const lot = lotSize(sym, rows[k].t.expiry, lotHistory)
      // Mid-segment joiner: size at the client's join (joinFloor), not the pre-join re-entry, so a
      // segment opened before they had capital isn't wrongly floored to 1 lot (scaleAt=0).
      const sizeDate = (joinFloor && rows[k].t.date < joinFloor) ? joinFloor : rows[k].t.date
      const cQty = roundToLot(scaleFn(sizeDate) * baseQty, lot)
      let j = k
      while (j < rows.length && rows[j].t.lots * rows[j].t.lot_size === baseQty) { qtyByIdx.set(rows[j].i, { cQty, lot }); j++ }
      k = j
    }
  }

  const legs = baseTrades.map((t, i) => {
    // Any leg outside the NIFTY/MIDCAP schedule (e.g. the stray NIFTYBANK leg) keeps its sheet qty,
    // scaled linearly — no lot-rounding.
    const { cQty, lot } = qtyByIdx.get(i) || { cQty: Math.round(scaleFn(t.date) * t.lots * t.lot_size), lot: t.lot_size }
    const f = cQty / (t.lots * t.lot_size)
    const baseGross = (t.direction === 'LONG' ? t.exit - t.entry : t.entry - t.exit) * (t.lots * t.lot_size)
    const charges = (baseGross - t.net_inr) * f   // round-trip charges @ client qty (footer; like the fut book)
    const isOpen = t.expiry === maxExpiry
    let net, exit
    if (isOpen && liveLtp?.[t.underlying] != null) {
      const live = liveLtp[t.underlying]
      const gross = (t.direction === 'LONG' ? live - t.entry : t.entry - live) * cQty
      net = gross - futEntryCharges(t.direction, cQty * t.entry, rates); exit = live
    } else { net = t.net_inr * f; exit = t.exit }
    return { date: t.date, underlying: t.underlying, expiry: t.expiry, month: t.expiry.slice(0, 7) + '-01', direction: t.direction, entry: t.entry, exit, lot, cQty, net, charges }
  }).filter(g => !joinFloor || g.month >= joinFloor)

  const combinedByMonth = {}
  for (const g of legs) combinedByMonth[g.month] = (combinedByMonth[g.month] || 0) + g.net
  const months = [...new Set(legs.map(g => g.month))].sort()
  let cum = 0
  const monthly = months.map(month => {
    const net = legs.filter(g => g.month === month).reduce((s, g) => s + g.net, 0)
    cum += net
    // capital_inr = the capital in force that month (timeline), so the variant's return re-bases at
    // each pay-in/pay-out too. Null when no timeline given → computeStats falls back to flat aumInr.
    const cap = capFn ? Math.round(capFn(month) * 1e7) : null
    return { month, net_inr: Math.round(net), gross_inr: Math.round(net), charges_inr: 0, cumulative_inr: Math.round(cum), capital_inr: cap }
  })
  const trades = legs.map(g => ({ ...g, combined: combinedByMonth[g.month] }))
  const charges = legs.reduce((s, g) => s + g.charges, 0)   // total round-trip charges over the window
  return { monthly, trades, charges }
}
