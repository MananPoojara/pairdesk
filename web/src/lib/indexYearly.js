// Buy-and-hold index return per CALENDAR year over the options window (2019 → Jul 2026), for the
// Yearly Net Return card's comparison bars. Computed from "DATA OF OHLC - Copy.xlsx" (sheets
// Nifty_D / Mid_Select_D daily closes):
//     return(year) = (last close of the year ÷ first close of the year − 1) × 100.
// Full calendar years 2019–2025; 2026 is partial (year-start → last close 2026-07-14).
// True NIFTY 50 and NIFTY MIDCAP SELECT closes. Regenerate if the window extends
// (re-run the per-year first→last close ratios on the OHLC sheets).
export const INDEX_YEARLY = {
  '2019': { nifty: 11.53, midcap: -4.39 },   // 2019-01-01 → 2019-12-31
  '2020': { nifty: 14.77, midcap: 23.26 },
  '2021': { nifty: 23.79, midcap: 35.18 },
  '2022': { nifty: 4.33,  midcap: -3.82 },   // corrected from 2.72 — didn't match Dec'21→Dec'22 monthly closes
  '2023': { nifty: 19.42, midcap: 44.16 },
  '2024': { nifty: 8.75,  midcap: 23.93 },
  '2025': { nifty: 10.05, midcap: 6.51 },
  '2026': { nifty: -8.01, midcap: 6.28 },    // 2026-01-01 → 14 Jul (last close)
}
