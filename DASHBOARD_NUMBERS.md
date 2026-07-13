# Dashboard — where every number comes from

A verification reference for the **Dashboard** page only. For each panel it lists
the number shown, **where it is derived from** (data source), and **exactly how it
is calculated** (formula + code location). Written so the figures can be checked
independently against the source data.

---

## 0. The two data sources

| View | Source of truth | Code |
|------|-----------------|------|
| **Live** (Combined · Fut — the default) | Postgres tables `trades` + `trade_charges`, served by `/api/dashboard` | `server/src/routes/dashboard.js` |
| **Options / BankNifty variants** (when those chips are selected) | Hardcoded, Excel-verified showcase data | `web/src/lib/variantData.js` (monthly) + `web/src/lib/variantTrades.js` (per-trade) |

**Deployed-capital base — `BASE_CR = ₹30 Cr` (`BASE_INR = 30 × 10⁷`).**
Every percentage on the Dashboard (return %, monthly %, yearly %, best/worst,
Sharpe) is computed on this ₹30 Cr base, **not** on the displayed AUM. This is the
single most important convention to verify against.
Source: `dashboard.js` lines 40–42.

**Per-trade P&L (the atom everything is built from)** — `dashboard.js` lines 51–54:
```
gross_inr = (exit_price − entry_price) × lots × lot_size      … for LONG
          = (entry_price − exit_price) × lots × lot_size      … for SHORT
net_inr   = gross_inr − charges_inr
```
`charges_inr` = STT + Exchange + SEBI + Stamp + GST for that trade
(`trade_charges` table, stored in paise; ÷100 → rupees).

**Quantity — must be exact.** `qty = lots × lot_size`, and `gross` above is
recomputed from `lots × lot_size`, so this product must equal the sheet's exact
quantity. The sheet uses spot-adjusted quantities that are *not* clean multiples of
the nominal NSE lot, so the ingest sets `lot_size = GCD(all of that symbol's
quantities)` (MIDCPNIFTY = 60, NIFTY = 50) and asserts `lots × lot_size == qty`.
`Data/ingest_pnl.py`. *(Fixed 2026-07-13 — previously a hardcoded lot_size floored
17 MIDCPNIFTY legs, dropping ~₹3.8 L of size and skewing those months' MoM.)*

---

## 1. Hero card — "Net PnL — Pair Trading"

| Number | Derived from | Formula / code |
|--------|--------------|----------------|
| **Net PnL (Overall)** `+₹13.95 Cr` | All closed trades, all clients | Running sum of monthly net → last cumulative value. `cumulative_inr = SUM(gross−charges) OVER (ORDER BY month)`; hero takes the final row. `dashboard.js` 83, 107, 198 |
| **Realised** | same | = Net PnL (every trade is closed, so all P&L is realised). `dashboard.js` 239 |
| **Unrealised** `₹0` | — | Always ₹0 in the Overall/Combined view (no open synthetic leg). `dashboard.js` 240 |
| **Return %** `+46.51%` | Net PnL ÷ base | `totalNet / (30 Cr) × 100`. `dashboard.js` 199 |
| **Date span** `1 Sep 24 → 30 Jun 26` | first & last trade month | range of the monthly series |
| **Today (`Today` toggle)** | last actual trade day in DB | net of the single most-recent `trade_date` = `Σ(gross) − Σ(charges)` for that day. `dashboard.js` 208–224 |

Front-end note: when a date range (1M/3M/1Y/All/custom) is applied, the hero
recomputes over the **selected** months via `buildDashboardRangeStats`
(`web/src/lib/dashboardRange.js`), still on the ₹30 Cr base.

---

## 2. "Book" card

| Number | Derived from | Formula / code |
|--------|--------------|----------------|
| **AUM** `₹10.0 Cr` | `clients` table | `SUM(aum_paise)` of active clients ÷ 10⁹. `dashboard.js` 33–39, 253 |
| **Exposure** | same | equals AUM here (`dashboard.js` 255); editable in the UI |
| **Clients** | `clients` | `COUNT(active clients)`. `dashboard.js` 257 |
| **Strategies** | fixed | `1` (Midcap × Nifty pair). `dashboard.js` 258 |

> Note: AUM (₹10 Cr) is the **book** figure. It is *not* the base for the
> percentages — those use the ₹30 Cr deployed base (see §0).

---

## 3. "Client Mix" card (moved into the hero band)

| Number | Derived from | Formula / code |
|--------|--------------|----------------|
| **client count** | `clients` | `d.clients.length` |
| **Retail / HNI / Institution %** | each client's `aum_cr` + `category` | share of total AUM per category: `mix[category] / Σ aum_cr × 100`. `Dashboard.jsx` 115–121 |

Category bands: Retail `<₹5 Cr`, HNI `₹5–100 Cr`, Institution `>₹100 Cr`.

---

## 4. Equity Curve card

| Number | Derived from | Formula / code |
|--------|--------------|----------------|
| **Curve (blue)** | monthly cumulative net | plots `cumulative_inr` per month |
| **Spot backtest (orange, live only)** | `Data/SpotData` spot series | naive spot pair benchmark, re-zeroed to the range. `dashboard.js` 286–291 |
| **Best mo** `+10.62%` | monthly nets | `max(month net) / 30 Cr × 100`. `dashboard.js` 105, 200 |
| **Worst** `−2.87%` | monthly nets | `min(month net) / 30 Cr × 100`. `dashboard.js` 106, 201 |
| **Max DD** `−2.5%` | cumulative curve | peak-to-trough: for each point `dd = (peak − value)/peak`; Max DD = worst `dd`. `dashboard.js` 19–27, 109 |
| **Sharpe** `2.15` | monthly % returns | `mean(monthly%) / stdev(monthly%) × √12`, where each `monthly% = net / 30 Cr × 100`. `dashboard.js` 9–15, 108 |
| **Win rate** `77%` | monthly nets | `count(month net > 0) / total months × 100`. `dashboard.js` 101–102 |

---

## 5. "Yearly Return" bars

| Number | Derived from | Formula |
|--------|--------------|---------|
| each year's **%** | that year's monthly nets | `Σ(net of the year's months) / 30 Cr × 100`. `web/src/lib/…` `yearlyReturns()` via `Dashboard.jsx` 104 |
| tooltip **net ₹** | same | sum of that year's monthly net (rupees) |

Calendar-year buckets (Jan–Dec). Partial years (e.g. 2024 from Sep, 2026 to Jun)
sum only the months present.

---

## 6. "Monthly Returns" heatmap (MoM) — *how it is calculated*

Each cell is **one month's return as a % of the ₹30 Cr deployed base**:

```
MoM %(month) = net_inr(month) / (30 × 10⁷) × 100
net_inr(month) = Σ over all trades that closed in that month of (gross_inr − charges_inr)
```

- `net_inr(month)` is the SQL `SUM(gross) − SUM(charges)` grouped by
  `date_trunc('month', trade_date)` — `dashboard.js` 45–85.
- The `× / 30 Cr × 100` conversion is `pct` in `dashboard.js` line 282
  (`pct = net_inr / BASE_INR × 100`, rounded to 3 dp).
- Cell colour = sign/magnitude of that %; blank cells = months with no trades.
- Row = year, column = calendar month ("by entry month" = the month the pair's
  result is booked).

**Cross-checks that must hold:**
- Sum of a year's 12 MoM % = that year's Yearly-Return bar (§5).
- Sum of *all* MoM % = the overall Return % (§1) — both are `Σ net / 30 Cr × 100`.

For the **Options/BankNifty variants** the same cell formula applies, but
`net_inr(month)` comes from `variantData.js` (Excel-derived monthly totals), not
the DB. Options months are **additive** on the ₹30 Cr base (sum → +263.05%);
BankNifty months are NAV-scaled (compounded → +49.02%). See
`web/src/lib/variantData.js` header + `Reference/` sheets.

---

## 7. "Margin" card

| Number | Formula / code |
|--------|----------------|
| **Margin (used)** `₹2.5 Cr` | `AUM × 0.25` — ≈ SPAN initial-margin proxy at 25%. `Dashboard.jsx` 124 |
| **Free** `₹7.5 Cr` | `AUM − margin`. `Dashboard.jsx` 125 |
| **25% utilised** | fixed ratio label |

---

## 8. "Return on AUM" card

| Number | Derived from | Formula / code |
|--------|--------------|----------------|
| **Return on AUM** `+46.51%` | total net | `totalNet / 30 Cr × 100` (same value as hero Return %). `Dashboard.jsx` 178, `pctOfBase` |
| **Avg AUM · deployed** `₹30.0 Cr` | base | the ₹30 Cr deployed base (`baseAumCr`). `Dashboard.jsx` |

---

## 9. "Exposure by leg" card

| Number | Formula / code |
|--------|----------------|
| **Nifty (SHORT)** / **Midcap (LONG)** `₹5.0 Cr` each | `exposure / 2` — the pair is dollar-neutral, so each leg = half of gross. `Dashboard.jsx` 126 |
| **Gross exposure** `₹10.0 Cr` | book exposure |
| **Net (L−S)** `₹0` | long − short ≈ 0 (market-neutral) |
| **Leverage** `1.00×` | `exposure / AUM`. `dashboard.js` 256 |

---

## 10. "Latest Day" strip

Last actual trade day (`dashboard.js` 208–224):

| Cell | Source |
|------|--------|
| **Net PnL / Realised** | that day's `Σ(gross) − Σ(charges)` |
| **Unrealised** `₹0` | closed book |
| **Trades** | `COUNT(*)` that day |
| **Exposure** `₹30 Cr` / **Margin** `₹7.5 Cr` | deployed base and 25% of it |

---

## 11. "Open Positions" table

Most-recent-expiry pair (`dashboard.js` 121–186):

| Column | Formula |
|--------|---------|
| **Entry** | trade `entry_price` |
| **LTP** | latest close from `fut_continuous` parquet (DuckDB). `dashboard.js` 144–164 |
| **Points** | LONG: `LTP − entry`; SHORT: `entry − LTP` |
| **Unrealised ₹** | `points × lots × lot_size`. `dashboard.js` 167–185 |

This is the only **live-priced** block; all performance panels above are on
closed/settled results.

---

## Quick verification recipe

1. Pull the monthly net table: `SUM(gross) − SUM(charges)` grouped by month
   (dashboard.js §1). 
2. Divide each month by ₹30 Cr × 100 → should reproduce every **MoM** cell.
3. Sum a year's months → **Yearly** bar. Sum all months → **Return %** and
   **Net PnL**.
4. `mean/stdev × √12` of the monthly % → **Sharpe**; `count(>0)/n` → **Win rate**;
   peak-to-trough on the cumulative → **Max DD**.

Every headline number reduces to the same monthly-net table on the ₹30 Cr base.
