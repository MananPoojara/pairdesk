// Generated from Reference/MidCap + Nifty Pair Trading_Updated spot 3-15_filled.xlsx (sheet 'P&L 30 Cr').
// SPOT-priced Midcap x Nifty pair at 30 Cr scale (index-level prices; NO normalisation needed).
// net_inr = monthly SPOT strategy P&L (sum of the sheet's per-trade Net Profit by EXPIRY month).
// buildBacktestRows() rescales by (aumCr / 30) and cumulates per selected window.
// The OPEN cycle (blank Exit in the sheet) is NOT baked here — dashboard.js marks its exit to the LIVE
// SPOT LTP (NIFTY MIDCAP SELECT / NIFTY 50) via spotOpenCycle + openCycleMonth (entry-side charges only).
export const SPOT_BACKTEST_BASE_AUM_CR = 30

// Pair combined Max Drawdown reference (kept as-is; live Max DD is computed on the frontend now,
// this constant is still consumed by strategies.js).
export const pairReferenceStats = { max_dd_pct: 3.14 }

export const spotBacktest = [
  { date: '2024-05-01', net_inr: 22536734, midcap_net_inr: 21595842, nifty_net_inr: 940892 },
  { date: '2024-06-01', net_inr: -4537182, midcap_net_inr: 16223433, nifty_net_inr: -20760615 },
  { date: '2024-07-01', net_inr: 9975874, midcap_net_inr: 14664406, nifty_net_inr: -4688532 },
  { date: '2024-08-01', net_inr: -2661073, midcap_net_inr: 7272593, nifty_net_inr: -9933666 },
  { date: '2024-09-01', net_inr: -10267749, midcap_net_inr: 3907389, nifty_net_inr: -14175137 },
  { date: '2024-10-01', net_inr: 3158752, midcap_net_inr: -19349711, nifty_net_inr: 22508463 },
  { date: '2024-11-01', net_inr: 7098523, midcap_net_inr: 3748815, nifty_net_inr: 3349708 },
  { date: '2024-12-01', net_inr: 11252621, midcap_net_inr: 9555311, nifty_net_inr: 1697310 },
  { date: '2025-01-01', net_inr: 21311312, midcap_net_inr: 27820560, nifty_net_inr: -6509248 },
  { date: '2025-02-01', net_inr: 10240591, midcap_net_inr: 19167371, nifty_net_inr: -8926780 },
  { date: '2025-03-01', net_inr: 1273895, midcap_net_inr: 15173137, nifty_net_inr: -13899242 },
  { date: '2025-04-01', net_inr: 10550219, midcap_net_inr: 19409404, nifty_net_inr: -8859184 },
  { date: '2025-05-01', net_inr: 4485420, midcap_net_inr: 12430205, nifty_net_inr: -7944785 },
  { date: '2025-06-01', net_inr: 6633150, midcap_net_inr: 16095768, nifty_net_inr: -9462618 },
  { date: '2025-07-01', net_inr: -1806738, midcap_net_inr: -12041396, nifty_net_inr: 10234658 },
  { date: '2025-08-01', net_inr: -5888725, midcap_net_inr: -9157500, nifty_net_inr: 3268775 },
  { date: '2025-09-01', net_inr: -72381, midcap_net_inr: 1448673, nifty_net_inr: -1521054 },
  { date: '2025-10-01', net_inr: 3058648, midcap_net_inr: 20963822, nifty_net_inr: -17905174 },
  { date: '2025-11-01', net_inr: 12635420, midcap_net_inr: 11882828, nifty_net_inr: 752591 },
  { date: '2025-12-01', net_inr: -6951883, midcap_net_inr: -6069693, nifty_net_inr: -882190 },
  { date: '2026-01-01', net_inr: -2861778, midcap_net_inr: -12769355, nifty_net_inr: 9907576 },
  { date: '2026-02-01', net_inr: 4842300, midcap_net_inr: 8209109, nifty_net_inr: -3366808 },
  { date: '2026-03-01', net_inr: 5843064, midcap_net_inr: -34720774, nifty_net_inr: 40563838 },
  { date: '2026-04-01', net_inr: 26527177, midcap_net_inr: 48325807, nifty_net_inr: -21798630 },
  { date: '2026-05-01', net_inr: 20024175, midcap_net_inr: 19490247, nifty_net_inr: 533927 },
  { date: '2026-06-01', net_inr: -6856500, midcap_net_inr: -7132221, nifty_net_inr: 275721 },
]

// Open spot cycle (most-recent expiry, exit not yet printed): marked to live SPOT in dashboard.js.
export const spotOpenCycle = {
  month: '2026-07-01',
  legs: [
    { underlying: 'MIDCPNIFTY', direction: 'LONG', entry_price: 14428.85, lots: 27240, lot_size: 1 },
    { underlying: 'NIFTY', direction: 'SHORT', entry_price: 23872.65, lots: 13200, lot_size: 1 },
  ],
}
