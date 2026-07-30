#!/usr/bin/env python3
"""
PairDesk ingest_option_legs.py

Ingest the LEGWISE options book into `option_trade_legs` (one row per leg, like futures `trades`),
populated from the money-model Excel (real NSE lot by expiry + full option charge model).

Source : Reference/option variation 2/Combined Trade Sheet - Legs (Options Money).xlsx
         598 pair-trades → 1,196 leg rows (leg 1 = short NIFTY option, leg 2 = MIDCAP100 hypo future).
Scope  : NEW table only. Live wide `option_trades` and all routes are untouched.
DB     : LOCAL dev only (127.0.0.1:5433 pairdesk_dev). Never Neon/prod.

Usage:  python3 Data/ingest_option_legs.py [--dry-run]
"""

import sys, os
import openpyxl
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime, date

DRY_RUN = "--dry-run" in sys.argv

HERE = os.path.dirname(__file__)
_CANDIDATES = [
    os.path.join(HERE, "../Reference/option variation 2"),
    "/home/server/Downloads/PairTrading_algo/Reference/option variation 2",
]
OPTDIR = next((p for p in _CANDIDATES if os.path.isdir(p)), _CANDIDATES[0])
# Final source: the date-sorted money file (strategy column already removed; keyed by Trade ID so
# row order doesn't matter to the ingest).
SRC      = os.path.join(OPTDIR, "Combined Trade Sheet - Legs (Options Money, Date Sorted).xlsx")
COMBINED = os.path.join(OPTDIR, "Combined Trade Sheet.xlsx")   # has "Entry Spot" (NIFTY spot at entry)
# NOTE: no `strategy` column is stored — the app derives it at read time from trade_no
# (server/src/data/optionLotCalc.js → optionPhase).

PG = dict(host="127.0.0.1", port=5433, user="pairdesk",
          password="pairdesk2026", dbname="pairdesk_dev")
DATABASE_URL = os.environ.get("DATABASE_URL")

DDL = """
DROP TABLE IF EXISTS option_trade_legs;
CREATE TABLE option_trade_legs (
  id                  BIGSERIAL PRIMARY KEY,
  trade_no            INT      NOT NULL,        -- 1..598, links the 2 legs of a trade
  leg                 SMALLINT NOT NULL,        -- 1 = option, 2 = midcap future
  instrument          TEXT     NOT NULL,        -- NIFTY | MIDCAP100
  segment             TEXT     NOT NULL,        -- OPT | FUT
  side                TEXT,                     -- SELL (opt) | LONG/SHORT (fut)
  opt_type            TEXT,                     -- CE | PE   (opt leg only)
  strike              NUMERIC(20,4),            -- opt leg only
  entry_spot          NUMERIC(20,4),            -- NIFTY spot at entry (opt leg only) — charge_pct denominator
  entry_date          DATE,
  exit_date           DATE,
  expiry              DATE,                     -- opt leg only
  entry_px            NUMERIC(20,4),            -- option premium / midcap spot
  exit_px             NUMERIC(20,4),
  lot_size            INT,                      -- opt leg only (real NSE lot by expiry)
  qty                 INT,                      -- opt leg only
  pnl_pts             NUMERIC(20,4),            -- leg P&L (points)
  pnl_pct             NUMERIC(20,10),
  mae                 NUMERIC(20,6),
  mfe                 NUMERIC(20,6),
  no_of_days          INT,                      -- fut leg only
  rollover_cost_pct   NUMERIC(20,6),            -- fut leg only
  exit_reason         TEXT,
  -- money model (NUMERIC rupees) — OPTION leg only; midcap leg NULL:
  gross_pnl_inr       NUMERIC(20,4),
  sell_prem_inr       NUMERIC(20,4),
  buy_prem_inr        NUMERIC(20,4),
  stt_inr             NUMERIC(20,4),
  exch_inr            NUMERIC(20,4),
  sebi_inr            NUMERIC(20,6),
  stamp_inr           NUMERIC(20,4),
  brokerage_inr       NUMERIC(20,4),
  gst_inr             NUMERIC(20,4),
  total_charges_inr   NUMERIC(20,4),
  net_pnl_inr         NUMERIC(20,4),
  net_pnl_pct         NUMERIC(20,10),
  charge_pct          NUMERIC(20,10),           -- total_charges_inr / (entry_spot × lot_size) × 100 (opt leg)
  -- trade-level, leg 1 only:
  combined_pnl_pts    NUMERIC(20,4),
  combined_pnl_pct    NUMERIC(20,10),
  strike_shift_reason TEXT,
  source              TEXT NOT NULL DEFAULT 'option_backtest_legwise'
);
CREATE INDEX ON option_trade_legs (trade_no);
CREATE INDEX ON option_trade_legs (entry_date);
"""

COLS = [
    'trade_no','leg','instrument','segment','side','opt_type','strike','entry_spot',
    'entry_date','exit_date','expiry','entry_px','exit_px','lot_size','qty',
    'pnl_pts','pnl_pct','mae','mfe','no_of_days','rollover_cost_pct','exit_reason',
    'gross_pnl_inr','sell_prem_inr','buy_prem_inr','stt_inr','exch_inr','sebi_inr',
    'stamp_inr','brokerage_inr','gst_inr','total_charges_inr','net_pnl_inr','net_pnl_pct','charge_pct',
    'combined_pnl_pts','combined_pnl_pct','strike_shift_reason','source',
]

def n(v):  return v if isinstance(v,(int,float)) else None
def dt(v): return v.date() if isinstance(v,datetime) else (v if isinstance(v,date) else None)
def s(v):  return v.strip() if isinstance(v,str) and v.strip() else None

def load_entry_spot():
    """trade_no → NIFTY Entry Spot, from Combined Trade Sheet.xlsx (row order == trade_no)."""
    wb = openpyxl.load_workbook(COMBINED, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    H = [str(h).strip() if h else '' for h in rows[0]]
    ci = {h:i for i,h in enumerate(H)}
    idx = ci.get('Entry Spot')
    spot = {i: (rows[i][idx] if idx is not None and isinstance(rows[i][idx],(int,float)) else None)
            for i in range(1, len(rows))}  # rows[1] == trade_no 1
    wb.close()
    return spot  # keyed by trade_no (== source row index)

def load_rows():
    espot = load_entry_spot()
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    H = [str(h).strip() if h else '' for h in rows[0]]
    ci = {h:i for i,h in enumerate(H)}
    def g(r,k): return r[ci[k]] if k in ci else None
    out = []
    for r in rows[1:]:
        leg = n(g(r,'Leg'))
        tno = int(n(g(r,'Trade ID')))
        if leg == 1:  # option leg
            lot = int(n(g(r,'Lot Size (real)'))) if n(g(r,'Lot Size (real)')) is not None else None
            total_ch = n(g(r,'Total Charges ₹'))
            spot = espot.get(tno)
            charge_pct = (total_ch / (spot * lot) * 100) if (total_ch is not None and spot and lot) else None
            out.append([
                tno, 1, 'NIFTY', 'OPT', s(g(r,'Side')), s(g(r,'Type')), n(g(r,'Strike')), spot,
                dt(g(r,'Entry Date')), dt(g(r,'Exit Date')), dt(g(r,'Expiry')),
                n(g(r,'Entry Price')), n(g(r,'Exit Price')), lot,
                int(n(g(r,'Qty (real)'))) if n(g(r,'Qty (real)')) is not None else None,
                n(g(r,'Leg P&L')), n(g(r,'Leg P&L %')), n(g(r,'MAE')), n(g(r,'MFE')),
                None, None, s(g(r,'Exit Reason')),
                n(g(r,'Gross P&L ₹')), n(g(r,'Sell Premium ₹')), n(g(r,'Buy Premium ₹')),
                n(g(r,'STT ₹')), n(g(r,'Exchange txn ₹')), n(g(r,'SEBI fee ₹')),
                n(g(r,'Stamp ₹')), n(g(r,'Brokerage ₹')), n(g(r,'GST ₹')),
                total_ch, n(g(r,'Net P&L ₹')), n(g(r,'Net P&L %')), charge_pct,
                n(g(r,'Combined Net P&L')), n(g(r,'Combined Net P&L %')), s(g(r,'Strike Shift Reason')),
                'option_backtest_legwise',
            ])
        else:  # midcap future leg
            out.append([
                tno, 2, 'MIDCAP100', 'FUT', s(g(r,'Side')), None, None, None,
                dt(g(r,'Entry Date')), dt(g(r,'Exit Date')), None,
                n(g(r,'Entry Price')), n(g(r,'Exit Price')), None, None,
                n(g(r,'Leg P&L')), n(g(r,'Leg P&L %')), n(g(r,'MAE')), n(g(r,'MFE')),
                int(n(g(r,'No Of Days'))) if n(g(r,'No Of Days')) is not None else None,
                n(g(r,'Rollover Cost %')), s(g(r,'Exit Reason')),
                None,None,None,None,None,None,None,None,None,None,None,None,None,
                None, None, None,
                'option_backtest_legwise',
            ])
    wb.close()
    return out

def main():
    rows = load_rows()
    print(f"loaded {len(rows)} leg rows from {os.path.basename(SRC)}")
    if DRY_RUN:
        print("dry-run: not writing. sample:", rows[0]); return
    conn = psycopg2.connect(DATABASE_URL) if DATABASE_URL else psycopg2.connect(**PG)
    conn.autocommit = False
    try:
        cur = conn.cursor()
        cur.execute(DDL)
        execute_values(cur,
            f"INSERT INTO option_trade_legs ({','.join(COLS)}) VALUES %s",
            rows, page_size=500)
        conn.commit()
        print(f"inserted {len(rows)} rows into option_trade_legs")
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()
