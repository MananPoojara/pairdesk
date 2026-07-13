// Generated from Reference/MidCap + Nifty Pair Trading_Updated spot 3-15.xlsx (sheet 'P&L 30 Cr').
// MIDCPNIFTY spot prices (~60,000 level) are normalised to futures-equivalent deployment
// by dividing MIDCAP P&L by (spot_entry / futures_entry) per pair (~4.45×).
// NIFTY spot ≈ NIFTY futures so no normalisation needed on that leg.
// net_inr is the monthly SPOT strategy P&L at 30 Cr deployment equivalent.
// buildBacktestRows() rescales by (aumCr / 30) and cumulates per selected window.
export const SPOT_BACKTEST_BASE_AUM_CR = 30

// max_dd_pct kept as the reference pair combined drawdown used across the app.
export const pairReferenceStats = { max_dd_pct: 2.55 }

export const spotBacktest = [
  { date: '2024-09-01', net_inr: -563815, midcap_net_inr: -23485795, nifty_net_inr: 22921980 },
  { date: '2024-10-01', net_inr: 4143966, midcap_net_inr: 824286, nifty_net_inr: 3319680 },
  { date: '2024-11-01', net_inr: 8438350, midcap_net_inr: 6569320, nifty_net_inr: 1869030 },
  { date: '2024-12-01', net_inr: 17211468, midcap_net_inr: 23495253, nifty_net_inr: -6283785 },
  { date: '2025-01-01', net_inr: 9729683, midcap_net_inr: 18570531, nifty_net_inr: -8840848 },
  { date: '2025-02-01', net_inr: 2687451, midcap_net_inr: 16506531, nifty_net_inr: -13819080 },
  { date: '2025-03-01', net_inr: 10502926, midcap_net_inr: 19145626, nifty_net_inr: -8642700 },
  { date: '2025-04-01', net_inr: 7380583, midcap_net_inr: 15127663, nifty_net_inr: -7747080 },
  { date: '2025-05-01', net_inr: 1290258, midcap_net_inr: 10733538, nifty_net_inr: -9443280 },
  { date: '2025-06-01', net_inr: -939139, midcap_net_inr: -11243719, nifty_net_inr: 10304580 },
  { date: '2025-07-01', net_inr: -4760048, midcap_net_inr: -8290388, nifty_net_inr: 3530340 },
  { date: '2025-08-01', net_inr: 1493550, midcap_net_inr: 2948190, nifty_net_inr: -1454640 },
  { date: '2025-09-01', net_inr: 2255429, midcap_net_inr: 19746749, nifty_net_inr: -17491320 },
  { date: '2025-10-01', net_inr: 3942181, midcap_net_inr: 3263701, nifty_net_inr: 678480 },
  { date: '2025-11-01', net_inr: -3123497, midcap_net_inr: -2410037, nifty_net_inr: -713460 },
  { date: '2025-12-01', net_inr: -5026083, midcap_net_inr: -15103623, nifty_net_inr: 10077540 },
  { date: '2026-01-01', net_inr: 6603790, midcap_net_inr: 9893890, nifty_net_inr: -3290100 },
  { date: '2026-02-01', net_inr: 911587, midcap_net_inr: -39919313, nifty_net_inr: 40830900 },
  { date: '2026-03-01', net_inr: 26913694, midcap_net_inr: 48882454, nifty_net_inr: -21968760 },
  { date: '2026-04-01', net_inr: 12954052, midcap_net_inr: 11871652, nifty_net_inr: 1082400 },
  { date: '2026-05-01', net_inr: -2605412, midcap_net_inr: -3238352, nifty_net_inr: 632940 },
  { date: '2026-06-01', net_inr: 1080177, midcap_net_inr: 2361237, nifty_net_inr: -1281060 },
]
