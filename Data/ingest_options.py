#!/usr/bin/env python3
"""
PairDesk ingest_options.py  (Phase 1 — data layer)

Ingest the Master Club 4.1 combined OPTION book (the fut×option F2O strategy) into a
dedicated `option_trades` table. The Master Club `master` sheet is the combined, phase-rotated
trade sequence (598 trades, 2019→2026); each row is enriched with its full leg detail by joining
back to the originating strategy's `Trade Sheet` on (Entry Date, Expiry).

Decisions (locked with the user):
  • Source        : Master Club 4.1 combined (`master` sheet), all 5 rotated strategies.
  • Window        : trim to entry_date >= 2024-05-01, to align with the futures book timeline.
  • Aggregation   : ADDITIVE (Σ Combined Net P&L %), matching how the app shows Options today.
  • Midcap leg    : use "Midcap Hypo P&L" (spot-adjusted, futures-equivalent).
  • Charges       : NOT itemised yet (0 for now) — user will provide the option charge model later.
  • Storage       : separate `option_trades` table (futures `trades` untouched).
  • DB            : LOCAL dev only (127.0.0.1:5433 pairdesk_dev). Never Neon/prod.

Usage:
  python3 Data/ingest_options.py [--dry-run]
"""

import sys, os
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from datetime import date

DRY_RUN = "--dry-run" in sys.argv

HERE = os.path.dirname(__file__)
# The option-variation Excels live in the outer repo's Reference/ (the nested copy's Reference is
# incomplete). Prefer the local ../Reference, fall back to the known outer location.
_CANDIDATES = [
    os.path.join(HERE, "../Reference/option variation 2"),
    "/home/server/Downloads/PairTrading_algo/Reference/option variation 2",
]
OPTDIR = next((p for p in _CANDIDATES if os.path.isdir(p)), _CANDIDATES[0])
MASTER = os.path.join(OPTDIR, "Master Club 4.1 .xlsx")
WINDOW_START = date(2024, 5, 1)          # trim to the futures-book timeline

# Master `master`.Phase → the strategy file that produced those trades
PHASE2FILE = {
    "1st Month":  "NIFTY_SELL_CE_ATM_1PCT_OTM_WEEKLY_BUY_MIDCAP100_Hypothetical_Future_T1_T1_Spot_Adjustment_RISE_1PCT_patchwise_1st.xlsx",
    "XTROC":      "NIFTY_SELL_CE_ATM_2PCT_ITM_WEEKLY_BUY_MIDCAP100_Hypothetical_Future_T1_T1_Spot_Adjustment_RISE_1PCT_patchwise_XTROC.xlsx",
    "M5DP":       "NIFTY_SELL_CE_ATM_WEEKLY_BUY_MIDCAP100_Hypothetical_Future_T1_T1_Spot_Adjustment_RISE_1PCT_patchwise_M5DP.xlsx",
    "TROC":       "NIFTY_SELL_CE_ATM_WEEKLY_BUY_MIDCAP100_Hypothetical_Future_T1_T1_Spot_Adjustment_RISE_1PCT_patchwise_TROC.xlsx",
    "Bear Short": "NIFTY_SELL_PE_ATM_2PCT_OTM_WEEKLY_SELL_MIDCAP100_Hypothetical_Future_T1_T1_Spot_Adjustment_RISE_1PCT_patchwise_Bear Short.xlsx",
}

PG = dict(host="127.0.0.1", port=5433, user="pairdesk",
          password="pairdesk2026", dbname="pairdesk_dev")
DATABASE_URL = os.environ.get("DATABASE_URL")

DDL = """
CREATE TABLE IF NOT EXISTS option_trades (
  id                   BIGSERIAL PRIMARY KEY,
  trade_no             INT,
  phase                TEXT NOT NULL,               -- source strategy (1st Month / XTROC / TROC / M5DP / Bear Short)
  entry_date           DATE NOT NULL,
  exit_date            DATE,
  expiry               DATE NOT NULL,
  opt_type             TEXT,                        -- CE | PE
  strike               NUMERIC(20,4),
  buy_sell             TEXT,                        -- SELL | BUY (option leg)
  qty                  INT,
  opt_entry_px         NUMERIC(20,4),               -- option premium at entry
  opt_exit_px          NUMERIC(20,4),               -- option premium at exit
  opt_pnl_pts          NUMERIC(20,4),               -- option leg P&L (points)
  midcap_entry_spot    NUMERIC(20,4),
  midcap_exit_spot     NUMERIC(20,4),
  midcap_hypo_pnl_pts  NUMERIC(20,4),               -- spot-adjusted, futures-equivalent
  combined_pnl_pts     NUMERIC(20,4),
  combined_pnl_pct     NUMERIC(20,10),              -- % of NAV (base 100) — the additive contributor
  exit_reason          TEXT,
  source               TEXT NOT NULL DEFAULT 'option_backtest'
);
"""

def d(v):
    if v is None: return None
    return pd.to_datetime(v).date()

def build_sheet_index(fname):
    """Index a strategy Trade Sheet by (entry_date, expiry) -> row dict."""
    path = os.path.join(OPTDIR, fname)
    df = pd.read_excel(path, sheet_name="Trade Sheet", header=0)
    df.columns = [str(c).strip() for c in df.columns]
    idx = {}
    for _, r in df.iterrows():
        if pd.isna(r.get("Entry Date")): continue
        idx[(d(r["Entry Date"]), d(r["Expiry"]))] = r
    return idx

def main():
    # 1. Combined sequence
    m = pd.read_excel(MASTER, sheet_name="master", header=1)   # row1 title, row2 header
    m.columns = [str(c).strip() for c in m.columns]
    m = m.dropna(subset=["Entry Date"])
    m["entry_date"] = m["Entry Date"].apply(d)
    m = m[m["entry_date"] >= WINDOW_START].copy()
    print(f"master rows in window (>= {WINDOW_START}): {len(m)}")

    caches, rows, joined, missed = {}, [], 0, 0
    for _, mr in m.iterrows():
        phase = str(mr["Phase"]).strip()
        fname = PHASE2FILE.get(phase)
        if fname not in caches:
            caches[fname] = build_sheet_index(fname)
        key = (d(mr["Entry Date"]), d(mr["Expiry"]))
        t = caches[fname].get(key)
        if t is None:
            missed += 1
            continue
        joined += 1
        rows.append((
            int(t["Trade"]) if not pd.isna(t.get("Trade")) else None,
            phase,
            d(t["Entry Date"]), d(t["Exit Date"]), d(t["Expiry"]),
            (str(t["Type"]).strip() if not pd.isna(t.get("Type")) else None),
            (float(t["Strike"]) if not pd.isna(t.get("Strike")) else None),
            (str(t["B/S"]).strip() if not pd.isna(t.get("B/S")) else None),
            (int(t["Qty"]) if not pd.isna(t.get("Qty")) else None),
            (float(t["Entry Price"]) if not pd.isna(t.get("Entry Price")) else None),
            (float(t["Exit Price"]) if not pd.isna(t.get("Exit Price")) else None),
            (float(t["CE P&L"]) if not pd.isna(t.get("CE P&L")) else None),
            (float(t["Midcap Entry Spot"]) if not pd.isna(t.get("Midcap Entry Spot")) else None),
            (float(t["Midcap Exit Spot"]) if not pd.isna(t.get("Midcap Exit Spot")) else None),
            (float(t["Midcap Hypo P&L"]) if not pd.isna(t.get("Midcap Hypo P&L")) else None),
            (float(t["Combined Net P&L"]) if not pd.isna(t.get("Combined Net P&L")) else None),
            (float(t["Combined Net P&L %"]) if not pd.isna(t.get("Combined Net P&L %")) else None),
            (str(t["Exit Reason"]).strip() if not pd.isna(t.get("Exit Reason")) else None),
            "option_backtest",
        ))
    print(f"join HIT: {joined} | MISS: {missed}")

    # 2. Reconcile (additive)
    add_total = sum((r[16] or 0) for r in rows)
    print(f"\nADDITIVE total (Σ Combined Net P&L %) over window = {add_total:.2f}%   [target ≈ +54.11%]")
    bym = {}
    for r in rows:
        k = r[4].strftime("%Y-%m-01")             # by EXPIRY month
        bym[k] = bym.get(k, 0) + (r[16] or 0)
    print("monthly (by expiry month) additive %:")
    for k in sorted(bym):
        print(f"   {k}  {bym[k]:+.3f}%")

    if DRY_RUN:
        print("\n--dry-run: no DB write."); return

    # 3. Write
    conn = psycopg2.connect(DATABASE_URL) if DATABASE_URL else psycopg2.connect(**PG)
    cur = conn.cursor()
    cur.execute(DDL)
    cur.execute("TRUNCATE option_trades RESTART IDENTITY")
    execute_values(cur, """
        INSERT INTO option_trades
          (trade_no, phase, entry_date, exit_date, expiry, opt_type, strike, buy_sell, qty,
           opt_entry_px, opt_exit_px, opt_pnl_pts, midcap_entry_spot, midcap_exit_spot,
           midcap_hypo_pnl_pts, combined_pnl_pts, combined_pnl_pct, exit_reason, source)
        VALUES %s
    """, rows)
    conn.commit()
    cur.execute("SELECT COUNT(*), ROUND(SUM(combined_pnl_pct)::numeric,2) FROM option_trades")
    n, tot = cur.fetchone()
    print(f"\nwrote {n} option_trades · Σ combined_pnl_pct = {tot}%")
    cur.close(); conn.close()

if __name__ == "__main__":
    main()
