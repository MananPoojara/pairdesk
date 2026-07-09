# PLAN.md — Midcap-Nifty Pair Trading Platform (Showcase Webapp)

> Status: **Phase 1 — Planning.** Living document. Updated per module as the user confirms.
> Last updated: 2026-06-30.

---

## 0. What this is

A web platform that **showcases** a Midcap–Nifty futures **pair-trading** strategy as if it were
running live, using ~2.5 years of historical results. Backtest is computed on **spot** data; the
showcase presents it as **live execution** (which is conceptually **futures**-price based). No real
live execution is wired yet, but every number must be correct and defensible.

**Strategy core (the thing being showcased):**
- **Bull leg:** Short Nifty future + Long Midcap future.
- **Bear leg:** Long Nifty future + Short Midcap future.
- **Rollover flag = 0:** hold to expiry, apply the above conditions normally.
- **Rollover flag = 1:** roll the expiring leg to the next expiry on **T-1** (previous trading day of
  current expiry).
- Full strategy logic + config + tradesheets to be provided later; this plan covers the *platform*,
  not the final strategy math.

---

## 0b. Strategy mechanics & data — CONFIRMED (2026-07-01)

**Mechanics (from user + the `P&L` sheet):**
- Each pair = **same quantity of lots on both legs** (1 lot Midcap + 1 lot Nifty; lot sizes 50 / 25).
- Position is **held while exposure compounds up** (notional grows with price / capital); no rebalance mid-trade.
- On a **regime flip (bull ↔ bear) the long/short assignment is swapped**:
  bull = LONG Midcap fut + SHORT Nifty fut; bear = LONG Nifty fut + SHORT Midcap fut.
- Monthly cadence with **T-1 rollover** (flag 1) as before. Exact flip trigger to be derived from the
  spot sheet (cost 0.15%, thresholds ±0.5%) and confirmed by reproducing the `P&L` sheet.

**Source-of-truth Excels (`Reference/`):**
- `Midcap-Nifty Pair spot.xlsx` → **spot backtest** (strategy sheet 81 cols + MoM/cumulative block).
- `MidCap + Nifty Pair Trading_Updated future 3-15.xlsx` → **futures "live" P&L**, trade-by-trade;
  columns = Orders module 1:1. **This is the reconciliation target.**

**Data (all 1-min, schema `Ticker,Date,Time,Expiry Date,OHLC,Volume,OI,Padding`):**
- Spot: `SpotData/NIFTY 50.csv` (2015→2026-06), `NIFTYMIDSELECT.csv` (2022→2026-02).
- Futures per-contract: `MIDCAP_FUT/` (80) + `NIFTY_FUT/` (93), ~2022→2025/26.
- Futures continuous/rolling: `NIFTY_F1.csv`, `MIDCPNIFTY_F1.csv` (2023-09→2026-06) + rolling xlsx.

**Parquet build (Phase-1 step 1):**
1. `spot_bars.parquet` ← SpotData (drives backtest).
2. `fut_bars.parquet` ← per-contract MIDCAP_FUT + NIFTY_FUT, partitioned by symbol+expiry
   (execution truth + T-1 rollover pricing).
3. `fut_continuous.parquet` ← F1/rolling (needed for continuous equity/chart marking between rolls).

**R4 derivability:** ~90% direct from data + Excels (PnL realised/unrealised, equity curve, exposure/leg,
MoM/YoY, win/trades/points, DD/Sharpe/CAGR, rollover, positions). **Modeled/assumed (flag on UI):**
margin (SPAN approx / % config), slippage (synthetic for backtest showcase), per-charge component split
(total reconciles to sheet's Total Expense), and **NIFTY BANK ticker is NOT in the dataset** (Nifty×Midcap
only — drop it or source separately). Client capital/categories = showcase overlay on the real strategy PnL.

## 1. Locked decisions (confirmed with user)

| Decision | Choice |
|---|---|
| **Stack** | **React** (frontend) + **Node** (backend) + **PostgreSQL** (data). Data lives in Postgres, not parquet — parquet/tradesheets are **ingested into Postgres** via an ETL step. |
| **Data timing** | Plan now, real data later. Build UI against dummy/seed data first; wire real schema when provided. |
| **Plan scope** | Architecture + all 7 modules (overview) + **Dashboard (deep)**. |
| **Palette** | **Warm Apricot + Sky.** Primary `#F97316`, Accent `#FB923C`, Secondary `#38BDF8`, Surface `#FFF7ED`, Text `#1E293B`. |
| **Design style** | **Hybrid** — SaaS KPI cards up top, dense styled tables below. |
| **Dark mode** | Light-first; design tokens structured so dark mode drops in later without rework. |
| **Leverage/Exposure edit level** | **Global default + per-strategy override** (NOT per-client). |

**Process rules (from user):** plan before implementing; one module per phase; phase closes only when
user says "next phase"; expect changes in every module — make smallest safe changes, never break what
works; ask before guessing on any trading-logic decision.

---

## 2. Architecture

```
┌──────────────┐     REST/JSON      ┌──────────────┐     SQL      ┌──────────────┐
│  React (Vite)│  ───────────────▶  │  Node API    │  ─────────▶  │  PostgreSQL  │
│  TS, light   │  ◀───────────────  │  (Express/   │  ◀─────────  │              │
│  orange×blue │                    │   Fastify)   │              │  + ETL jobs  │
└──────────────┘                    └──────────────┘              └──────────────┘
                                          ▲                              ▲
                                  Angel One API (.env)          parquet/xlsx tradesheets
                                  (future live feed)            ingested at build time
```

- **Frontend:** React + TypeScript + Vite. Charts: Recharts or ECharts (decide at Dashboard build).
  State/data: TanStack Query. Routing: React Router. Design tokens via CSS variables (enables dark mode).
- **Backend:** Node (Express or Fastify) + TypeScript. Layered: routes → services → repositories.
  All money/PnL math computed server-side and returned ready-to-render (frontend never recomputes
  charges). Money stored as integer paise or `NUMERIC` — never float.
- **DB:** PostgreSQL. Tables seeded from ingested historical pair-trade results.
- **Ports:** follow existing convention if relevant — frontend `5173/5174`, backend `8420/8421`
  (to confirm; the parent CLAUDE.md two-terminal convention may not apply to this fresh project).

### Proposed data model (first draft — refine when real data arrives)

- `clients` — id, name, client_code, category (`retail`|`hni`|`institution`), registration_date,
  capital_deployed, status.
- `strategies` — id, name, type (`pair`), index_scope, config_json.
- `client_strategies` — client_id, strategy_id, start_date, end_date(null=active), starting_capital,
  ending_capital, leverage (override-nullable), exposure (override-nullable), status.
- `platform_settings` — global leverage default, global exposure default, charge-rate config.
- `instruments` — symbol, index (`NIFTY`/`NIFTY MIDCAP SELECT`/`BANKNIFTY`), instrument_type
  (`FUT`|`SYNTHETIC_FUT`|`OPT`), lot_size, expiry.
- `trades` — id, client_strategy_id, symbol, expiry, trade_type (`LONG`|`SHORT`), instrument_type,
  qty, entry_price, exit_price, entry_time, exit_time, is_rollover, rollover_leg_ref.
- `trade_charges` — trade_id, stt, exchange_fee, sebi_fee, stamp_duty, gst, brokerage, total_expense.
- `daily_pnl` — client_strategy_id, date, realised, unrealised, margin_used, margin_total.
- `ledger` — client_id, strategy_id, date, type (`payin`|`payout`), amount, balance.

Category thresholds: **Retail < ₹5 cr**, **HNI ₹5 cr – ₹100 cr**, **Institution > ₹100 cr**.

---

## 2c. Backend architecture — LOCKED (2026-06-30)

**Shape: modular monolith** (one Node process, clean internal modules) — chosen for a single-PC
dev+server box. No microservices/k8s. UI = R4 (locked).

### Principle — precompute, then serve reads
Heavy work never touches the request path.
- **Write/compute world (batch + later live worker):** ingest (parquet/tradesheets → Postgres via
  `COPY`) → deterministic **engine** (PnL, charges, margin, slippage, rollover) → write **read models**.
- **Read world (request path):** API serves precomputed read-model rows via 1–2 indexed `SELECT`s +
  in-process LRU cache → **dashboard < 50 ms**. No per-request recompute.

```
parquet/xlsx ─▶ INGEST(COPY) ─▶ Postgres(raw) ─▶ ENGINE(deterministic) ─▶ read models(matviews)
Angel One WS ─▶ tick worker ─▶ mark unrealised ─▶ WS push                       │
React(R4) ◀── Node API (thin reads + LRU) ◀── Postgres (NUMERIC system-of-record)┘
analytics ◀── DuckDB (embedded, columnar) over historical bars/trades
```

### Stack components
- **Postgres 14.23 (installed)** = system of record. Money `NUMERIC(20,4)`/integer paise, never float.
  Per-exchange rounding centralised. Partition `fut_bars`/`trades` by month; index `(client_id,date)`,
  `(strategy_id,date)`.
- **DuckDB (embedded, add now)** = analytics accelerator for MoM/YoY/heatmap over 2.5y of bars/trades.
  No server; reads the same data columnar. Postgres stays the source of truth; DuckDB is read-only fast path.
- **Node v24.11.1 (installed)** = API + engine modules. Thin read endpoints; command endpoints
  (edit leverage/exposure, onboard client, broker connect) validated → written → **audit-logged**.
- **WebSocket** channel for live ticker / open positions / unrealised PnL.
- **React/Vite (R4)** + TanStack Query (cache-then-revalidate, prefetch on hover) + WS.

### Correctness gate
- One engine, one `charge_config` (as-of date), decimal math, exchange rounding.
- **Append-only trades + double-entry ledger** (every rupee matched) → auditable, idempotent ingest.
- **Reconciliation harness vs the Excel sheets** is the acceptance gate: engine must tie out to the
  rupee against the current Excel results before anything is "live." Golden tests guard drift.

### Dev / live isolation — separate DBs on this PC (LOCKED)
- `pairdesk_dev` and `pairdesk_live` (separate databases, same Postgres instance). Dev work never
  touches showcase/live data. Existing port convention: UI 5173/5174, API 8420/8421.
- Run via `systemd`/pm2: Postgres + Node API + engine worker + reverse proxy (Caddy auto-TLS or nginx).

### Resource budget & constraints (this box)
- **CPU:** i5-10500, 12 cores — ample for the monolith + DuckDB.
- **RAM: 15 GB, currently tight (swap maxed).** Tune Postgres conservatively: `shared_buffers` ≈ 2 GB,
  `work_mem` modest, `effective_cache_size` ≈ 6 GB. DuckDB memory-capped. Don't co-run heavy dev builds
  with the live services.
- **Disk: 916 GB, only ~22 GB free (98%) — RISK.** Showcase data is small (futures EOD bars for
  Nifty/Midcap/Bank + ~3.6k trades + ledgers ≈ **< 1 GB** in PG; DuckDB similar). **Action: reclaim
  headroom before running services** — ~17 GB safely from `~/.cache` (5.5 GB) + Rust `target/` dirs
  (~11 GB, regenerable); larger reclaim available from old project folders (`research-task` 37 GB,
  `StockMock-Copy` 27 GB, `fno-autopilot…` 15 GB) at user's discretion. Put PG data + DuckDB files
  under a dedicated path; nightly `pg_dump` + WAL archive; broker secrets encrypted at rest; DB bound
  to localhost.

### Open decisions deferred
- Whether to split the engine into its own service later (only if load demands; monolith for now).
- Tick/intraday data retention (tick data is the only thing that grows disk materially).

## 3. Money math (researched — Indian F&O, 2026)

All charges computed server-side per trade and stored in `trade_charges`. Rates are config-driven in
`platform_settings` so they can be updated without code changes.

**For FUTURES (FY2026, effective Apr 1 2026):**
- **STT** = 0.05% on **sell-side** turnover (futures valued at traded price).
- **Exchange transaction charge** = ~₹1.73 per lakh of turnover (≈0.0000173 ×), both buy & sell. *(NSE
  rate to confirm against latest circular at build time.)*
- **SEBI turnover fee** = 0.0001% (₹10 per crore) on buy+sell turnover, + 18% GST on the fee.
- **Stamp duty** = buy-side only (state-dependent; futures ≈ 0.002%). To confirm exact rate.
- **GST** = 18% on (brokerage + exchange charges + SEBI fee).
- **Brokerage** = per broker (Affluence / Sharekhan) — config per broker.

`Gross Profit = (Exit − Entry) × Qty × point_value` (sign by trade_type).
`Net Profit = Gross Profit − Total Expense`.
`Points = Exit − Entry`. `Total Turnover = Buy Value + Sell Value`.

> ⚠️ These rates change with circulars/budgets. Keep them in a single config table and show an "as-of"
> date in Admin. Verify against NSE/Angel One charge sheet before any number is presented as final.

---

## 4. Module overview (all 7)

Each gets its own deep-dive section in a later phase. Summary contract here.

1. **Dashboard** — platform-wide + Today's stats, KPIs, charts, open positions. *(Deep in §5.)*
2. **Orders** — all-client order blotter; History + Today's tabs; search by client, filter by index
   (3 indices)/date/strategy. UI columns: Date, Client Name, Symbol, Expiry, Trade Type, Instrument
   Type, Qty, Entry Price, Gross Profit, Total Turnover, Total Expense, Net Profit. **Excel export**
   adds: Client Code, Exit Price, Points, Sell Value, Buy Value, STT, Exchange Fee, SEBI Turnover Fee,
   Stamp Duty, GST.
3. **Clients** — grouped by **HNI / Institution / Retail**; per-client summary cards (name, reg date,
   capital deployed, exposure, strategy list) → drill into per-strategy stats (start/end capital,
   start/end date, leverage, exposure, max risk per trade daily/weekly Mon–Sun/monthly 1–31, gross &
   net PnL in ₹ and %), overall margin (used/total/unused — client-level only), slippage (+/- for spot
   and future), MoM & WoW tables, trade history. Time + strategy + index filters.
4. **Strategies** — strategy cards + stats; MoM and YoY per strategy; index-wise filters; PnL (₹ and %),
   no. of trades; **compare strategies** view; xlsx export. (Today: one strategy — pair trading.)
5. **History** — transaction ledger (pay-in / pay-out), filter by client + strategy + index.
6. **Admin** — platform settings: leverage/exposure global default, charge-rate config + as-of date,
   user/role management, data ingestion status. *(Scope to refine.)*
7. **Broker** — Affluence + Sharekhan (logos from their sites); **add-client** with broker auth params;
   plus **Futures** and **Synthetic Future** options (live execution would trade on futures values, as
   options are traded today).

---

## 5. Dashboard — DEEP DIVE (Phase 1 target)

### 5.1 Layout (Hybrid: cards top, dense tables bottom)

```
┌───────────────────────────────────────────────────────────────────────┐
│  Header: logo · platform name · global filters (Index ▾ | Strategy ▾)   │
├───────────────────────────────────────────────────────────────────────┤
│  OVERALL STATS                                          [Today ⟷ Overall]│
│  ┌ AUM ┐ ┌ Exposure ┐ ┌ Leverage ┐ ┌ #Strategies ┐ ┌ #Clients ┐ ┌ Net PnL ┐
│  │ ₹.. │ │  ₹..  1x │ │  edit ✎  │ │   summary→  │ │ pie+→    │ │ R / U   │
│  └─────┘ └──────────┘ └──────────┘ └─────────────┘ └──────────┘ └─────────┘
│                                                                         │
│  ┌──────────────────────┐   ┌──────────────────────────────────────┐   │
│  │ 3 line charts:        │   │  OPEN POSITIONS (scrollable table)     │  │
│  │  • Capital deployed   │   │  filter: Long | Short                  │  │
│  │  • # Clients          │   │  styled, compact rows                  │  │
│  │  • Net PnL (realised) │   │                                        │  │
│  └──────────────────────┘   └──────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────────────┤
│  TODAY'S STATS  (same KPIs, NO charts)                                   │
│  ┌ AUM ┐ ┌ Exposure ┐ ┌ Leverage ┐ ┌ #Strategies ┐ ┌ #Clients ┐ ┌ PnL ┐ │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.2 KPI definitions & calculations

- **Total AUM** = Σ deployed capital across all clients.
- **Total Exposure** = capital deployed per leg (e.g. ₹100 cr Midcap + ₹100 cr Nifty in a pair =
  **₹100 cr exposure**, because legs net to one notional book). **Leverage = Exposure / AUM** (1x in
  example). Exposure & leverage are **related and both editable** at **global default + per-strategy
  override** level; editing one recomputes the other.
- **No. of strategies** — count; card shows mini-summary; click → Strategies page.
- **No. of clients** — count + **% distribution pie** (Retail / HNI / Institution). Click opens a
  **popup** (not full navigation, to avoid clutter) with capital + strategies per client; "see more"
  → Clients page.
- **Net PnL** — show **Realised** (closed, net of all costs) and **Unrealised** (open positions) side
  by side. Filters:
  - **Index filter:** NIFTY BANK, NIFTY 50, NIFTY MID SELECT, **All-combined**.
  - **Pair rule:** a pair strategy on Midcap×Nifty must **not be double-counted** under a single-index
    filter; its PnL appears only under **All-combined**.
- **Charts (Overall only):** 3 separate line charts — Capital deployed, # Clients, Net PnL (realised),
  over time. Placement: left column beside Open Positions (final layout decided during build).
- **Open positions:** table of all open positions across strategies, Long/Short filter, vertical
  scroll, compact styled rows (must fit alongside charts).

### 5.3 Today's section

Same KPI set as Overall **minus the charts**. "Today" = current trading session aggregates.

### 5.4 Dashboard decisions (CONFIRMED 2026-06-30)

1. **Edit ✎ on Exposure/Leverage card → BOTH.** Card exposes the global default AND a per-strategy
   override panel. Editing exposure recomputes leverage and vice-versa (`Leverage = Exposure / AUM`).
2. **"Today" = latest available trading day** in the dataset (historical showcase).
3. **Charts:** default **All (~2.5y), daily EOD**, with **1M/3M/1Y/All toggle PLUS an explicit
   from-date / to-date range picker.**
4. **Unrealised PnL:** open futures marked at **last available EOD close.**
5. **Pos/neg colours:** stay within the orange×blue theme — **one light, one slightly darker** tone
   (not harsh green/red), so they accommodate the palette. Working choice: **positive = sky blue
   (light), negative = deeper orange/terracotta**; finalise exact shades in the mockup.

Still to confirm during mockup: exact fields shown per client in the **clients pie popup**.

---

## 6. Design system (Warm Apricot + Sky)

Tokens (CSS variables, light theme; `--*-dark` reserved for later):

```
--color-primary:    #F97316;  /* apricot orange — CTAs, KPI accents, active */
--color-accent:     #FB923C;  /* light orange — hovers, secondary highlights */
--color-secondary:  #38BDF8;  /* sky blue — chart lines, links, structure */
--color-surface:    #FFF7ED;  /* warm off-white canvas */
--color-panel:      #FFFFFF;  /* cards */
--color-text:       #1E293B;  /* slate */
--color-pos:        #38BDF8;  /* sky blue (light) = positive PnL */
--color-neg:        #C2410C;  /* deeper orange/terracotta = negative PnL — finalise shade in mockup */
```

- **Cards:** white panels, soft shadow, rounded; orange accent bar/number, blue chart line.
- **Tables:** dense rows, sticky header, zebra in warm tint, orange active-row, scroll containers.
- Run **frontend-design skill** + pull **Dribbble** references (fintech dashboard, orange/blue) at
  Dashboard build; present 2–3 concrete mockups before coding. Ask user for any reference images.

---

## 6b. UI direction — LOCKED (2026-06-30)

- **Chosen design: R4 "Quant Top"** — `mockups/dashboard-r4.html`. Top nav only (no side menu),
  inline underlined nav + a 3-index ticker sub-bar, **deep brand-blue Net-PnL hero** (`#13233A→#1B3251`
  with orange→sky text `#FDBA74→#7DD3FC` and a warm orange glow), then a dense quant bento.
- **Shared stylesheet:** `mockups/theme.css` — single source of design tokens + components (appbar,
  ticker, KPI ribbon, hero, tiles, pie/donut/gauge/meter, heatmap, today strip, tables, forms, modal).
  Every page links it → all 7 pages are visually identical and easy to port to React component CSS.
- **All 7 page mockups built** (static HTML, dummy data): dashboard-r4, orders, clients, strategies,
  history, broker, admin. Served at `http://localhost:5191/` (gallery `index.html`).
- Pos=blue `#0EA5E9`, neg=terracotta `#C2410C`.

### Canonical dummy dataset (used across the new pages — keep consistent)
6 clients, strategy = Pair Trading (Midcap × Nifty):
- Institution (>₹100 Cr): **Ashford Capital Partners** PD-INST-01 ₹142.0 Cr (reg 12 Feb 24);
  **Meridian Pension Fund** PD-INST-02 ₹118.0 Cr (03 Apr 24).
- HNI (₹5–100 Cr): **Rohan Khanna** PD-HNI-01 ₹64.0 Cr (21 Jun 24); **Vaidehi Mehta** PD-HNI-02 ₹38.0 Cr (09 Sep 24).
- Retail (<₹5 Cr): **Sanjay Iyer** PD-RTL-01 ₹4.2 Cr (17 Jan 25); **Priya Nair** PD-RTL-02 ₹3.1 Cr (28 Mar 25).
- Totals: AUM **₹369.3 Cr**, mix Inst 70.4% / HNI 27.6% / Retail 2.0%. Realised +₹14.2 Cr, Unrealised +₹0.86 Cr.

✅ **Reconciled:** dashboard-r4 updated to the canonical ₹369.3 Cr set (AUM/exposure, pie 2/28/70,
legs ₹184.6/₹184.6, margin ₹92.3/₹277). All 7 pages now agree.

### R4 made interactive (prototype, dummy data, vanilla JS — no backend yet)
- **Dashboard:** Overall⟷Today swaps hero figures; **edit ✎** opens an Exposure/Leverage editor
  (linked: Leverage = Exposure ÷ AUM; scope = global default / per-strategy) and live-updates the KPI,
  gauge arc, and leg split; **Open client breakdown** opens a popup (6 clients, category subtotals,
  link to Clients); positions **All/Long/Short** filter + **client search**; **date-range** 1M/3M/1Y/All
  updates the label; **index dropdown** menu.
- **Clients:** **View detail** on any client opens a data-driven modal (strategy history, PnL, max risk
  daily/weekly/monthly, margin used/total/unused, slippage); **+ Add client** opens a stub form.
- Remaining pages (Orders/Strategies/History/Broker/Admin) are still static mockups — wire on request.
- Logic/data/security to be added in the React build; these JS handlers are the behavioural blueprint.

## 7. Phasing

- **Phase 1 (now):** Architecture + this plan + **Dashboard** design & build. Seed 6 dummy clients
  (2 each: Retail/HNI/Institution) + pair-trading strategy with ~2.5y of results so it looks legit.
- **Phase 2+:** Orders → Clients → Strategies → History → Broker → Admin, one per phase, each opened by
  user saying "next phase". Real parquet/tradesheet/Angel One data wired when provided.

---

## 8. Open items awaiting user assets

- Parquet futures data + tradesheets (→ defines real schema & ingestion).
- Angel One `.env` (future live feed).
- Broker logos (Affluence, Sharekhan).
- Final strategy logic/config + rollover rule details.
- Confirmation on §5.4 Dashboard questions + positive/negative colour convention.

Sources used for charge/rollover research:
[NSE levies](https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies) ·
[Zerodha charges](https://zerodha.com/charges/) ·
[Angel One pricing](https://www.angelone.in/exchange-transaction-charges) ·
[ClearTax STT](https://cleartax.in/s/securities-transaction-tax-stt) ·
[Futures rollover guide](https://www.tradingsim.com/blog/futures-contracts-rollover)
