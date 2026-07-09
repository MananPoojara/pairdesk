#!/usr/bin/env python3
"""
PairDesk ingest_pnl.py
Read the futures P&L Excel sheet, recompute every charge row-by-row,
reconcile vs. Excel, then upsert into pairdesk_dev.

Usage:
  python3 Data/ingest_pnl.py [--dry-run]
"""

import sys, os, math
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from datetime import date

EXCEL = os.path.join(os.path.dirname(__file__),
        "../Reference/MidCap + Nifty Pair Trading_Updated future 3-15.xlsx")
SHEET = "P&L 30 Cr"

# Local Docker Postgres by default. To seed a cloud DB (Neon/Supabase/Render),
# set DATABASE_URL and it will be used instead.
PG = dict(host="127.0.0.1", port=5433, user="pairdesk",
          password="pairdesk2026", dbname="pairdesk_dev")
DATABASE_URL = os.environ.get("DATABASE_URL")

DRY_RUN = "--dry-run" in sys.argv

# ── Charge formulas (confirmed vs. Excel) ─────────────────────────────────────
# STT rate changed after Indian Budget (effective ~2026-03-01)
STT_RATE_OLD  = 0.0002   # 0.02%  up to 2026-02-28
STT_RATE_NEW  = 0.0005   # 0.05%  from 2026-03-01
STT_CUTOFF    = date(2026, 3, 1)

EXCH_RATE     = 0.0000173  # 0.00173% of turnover
SEBI_RATE     = 0.000001   # 0.0001%  of turnover
STAMP_RATE    = 0.0002     # 0.02%  of buy value
GST_RATE      = 0.18       # 18%    on (exchange + sebi)

def compute_charges(trade_date, direction, qty, entry_price, exit_price):
    """Return dict of charges in rupees (float, for reconciliation)."""
    if direction == "LONG":
        sell_val = qty * exit_price
        buy_val  = qty * entry_price
    else:  # SHORT
        sell_val = qty * entry_price
        buy_val  = qty * exit_price

    turnover = sell_val + buy_val
    stt_rate = STT_RATE_NEW if trade_date >= STT_CUTOFF else STT_RATE_OLD
    stt      = sell_val   * stt_rate
    exch     = turnover   * EXCH_RATE
    sebi     = turnover   * SEBI_RATE
    stamp    = buy_val    * STAMP_RATE
    gst      = (exch + sebi) * GST_RATE
    total    = stt + exch + sebi + stamp + gst

    return dict(
        sell_value=sell_val, buy_value=buy_val, turnover=turnover,
        stt=stt, exchange=exch, sebi=sebi, stamp=stamp, gst=gst,
        total=total
    )

def to_paise(rupees):
    return round(rupees * 100)

# ── Load Excel ─────────────────────────────────────────────────────────────────
df = pd.read_excel(EXCEL, sheet_name=SHEET, header=0)
df = df.dropna(subset=["Date "])
df.columns = [c.strip() for c in df.columns]
df["date"]   = pd.to_datetime(df["Date"]).dt.date
df["expiry"] = pd.to_datetime(df["Expiry"]).dt.date
trades = df[["date","Symbol","expiry","Trade Type","Qty",
             "Entry Price","Exit Price","Net Profit",
             "Total Expense","Gross Profit"]].copy()
trades.columns = ["date","symbol","expiry","direction","qty",
                  "entry","exit","net_profit_xl","total_exp_xl","gross_xl"]

print(f"\n{'='*68}")
print(f"{'RECONCILIATION':^68}")
print(f"{'='*68}")
print(f"{'#':<3} {'Date':<12} {'Sym':<12} {'Dir':<6} {'Qty':>7}  "
      f"{'Points':>8}  {'Gross':>14}  {'Charges':>12}  {'Net':>14}  {'Diff':>8}")
print(f"{'-'*68}")

errors = 0
rows_out = []

for i, r in trades.iterrows():
    d     = r["date"]
    sym   = r["symbol"]
    dirn  = r["direction"]
    qty   = int(r["qty"])
    entry = float(r["entry"])
    exit_ = float(r["exit"])

    if dirn == "LONG":
        points = exit_ - entry
    else:
        points = entry - exit_

    gross = points * qty
    ch    = compute_charges(d, dirn, qty, entry, exit_)
    net   = gross - ch["total"]

    diff  = net - float(r["net_profit_xl"])

    ok = abs(diff) < 1.0   # within ₹1 tolerance
    if not ok:
        errors += 1

    flag = "✓" if ok else f"✗ Δ{diff:+.2f}"
    lot_size = 50 if sym == "MIDCPNIFTY" else 25
    regime   = "BULL" if (sym == "MIDCPNIFTY" and dirn == "LONG") or \
                         (sym == "NIFTY" and dirn == "SHORT") else "BEAR"
    leg      = "BULL" if sym == "MIDCPNIFTY" else "BEAR"

    print(f"{i:<3} {str(d):<12} {sym:<12} {dirn:<6} {qty:>7}  "
          f"{points:>8.2f}  {gross:>14,.0f}  {ch['total']:>12,.0f}  "
          f"{net:>14,.0f}  {flag}")

    rows_out.append(dict(
        trade_date=d, underlying=sym,
        contract=f"{sym}{d.strftime('%y%b').upper()}FUT",          # entry-month label
        contract_expiry=f"{sym}{r['expiry'].strftime('%y%b').upper()}FUT",  # expiry-month (matches parquet)
        expiry=r["expiry"], direction=dirn,
        lots=qty // lot_size, lot_size=lot_size,
        entry_price=entry, exit_price=exit_,
        points=points, gross_paise=to_paise(gross),
        stt_paise=to_paise(ch["stt"]),
        exchange_paise=to_paise(ch["exchange"]),
        sebi_paise=to_paise(ch["sebi"]),
        stamp_paise=to_paise(ch["stamp"]),
        gst_paise=to_paise(ch["gst"]),
        total_charges_paise=to_paise(ch["total"]),
        net_paise=to_paise(net),
        regime=regime, leg=leg,
    ))

print(f"\n{'='*68}")
total_net_computed  = sum(r["net_paise"] for r in rows_out) / 100
total_net_xl        = float(trades["net_profit_xl"].sum())
total_gross         = sum(r["gross_paise"] for r in rows_out) / 100
total_charges       = sum(r["total_charges_paise"] for r in rows_out) / 100

print(f"Trades:          {len(rows_out)}")
print(f"Errors (>₹1):   {errors}")
print(f"Gross PnL:       ₹{total_gross:>20,.2f}")
print(f"Total charges:   ₹{total_charges:>20,.2f}")
print(f"Net PnL (ours):  ₹{total_net_computed:>20,.2f}")
print(f"Net PnL (Excel): ₹{total_net_xl:>20,.2f}")
print(f"Diff:            ₹{total_net_computed - total_net_xl:>20,.2f}")
print(f"{'='*68}")

if errors > 0:
    print(f"\n⚠️  {errors} row(s) exceed ₹1 tolerance — check charge formulas.")
    sys.exit(1)
else:
    print("\n✅  Reconciliation PASSED — all rows within ₹1.")

if DRY_RUN:
    print("\n[dry-run] skipping DB write.")
    sys.exit(0)

# ── Seed DB ───────────────────────────────────────────────────────────────────
print("\nWriting to pairdesk_dev …")
conn = psycopg2.connect(DATABASE_URL) if DATABASE_URL else psycopg2.connect(**PG)
cur  = conn.cursor()

# Seed strategy
cur.execute("""
    INSERT INTO strategies (code, name, description)
    VALUES ('MIDCAP_NIFTY_PAIR',
            'Midcap × Nifty Pair Trade',
            'Long Midcap fut + Short Nifty fut (Bull) / Short + Long (Bear). Monthly rollovers.')
    ON CONFLICT (code) DO NOTHING
    RETURNING id
""")
row = cur.fetchone()
if row:
    strategy_id = row[0]
else:
    cur.execute("SELECT id FROM strategies WHERE code='MIDCAP_NIFTY_PAIR'")
    strategy_id = cur.fetchone()[0]

# Single real client — AUM ₹30 Cr (sheet: P&L 30 Cr)
cur.execute("""
    INSERT INTO clients (code, name, category, aum_paise)
    VALUES ('TEST', 'Test', 'Retail', 30_000_000_000)  -- ₹30 Cr
    ON CONFLICT (code) DO UPDATE
      SET name=EXCLUDED.name, category=EXCLUDED.category, aum_paise=EXCLUDED.aum_paise
    RETURNING id
""")
client_id = cur.fetchone()[0]

# Deactivate any other clients from previous runs
cur.execute("UPDATE clients SET is_active=FALSE WHERE code != 'TEST'")

cur.execute("""
    INSERT INTO client_strategies (client_id, strategy_id, allocation_paise, joined_at)
    VALUES (%s, %s, 30_000_000_000, '2024-09-26')
    ON CONFLICT (client_id, strategy_id) DO NOTHING
""", (client_id, strategy_id))

print(f"  Seeded 1 client (Test / Retail / ₹30Cr) + strategy")

# Insert trades (clear first so re-run is idempotent)
cur.execute("DELETE FROM trade_charges")
cur.execute("DELETE FROM trades")

client_rows = [(client_id, 300_000_000)]
trade_ids_by_client = {client_id: []}

for tr in rows_out:
    for cid, aum in client_rows:
        lots  = tr["lots"]   # actual lots from Excel, no proportional split
        cur.execute("""
            INSERT INTO trades
              (client_id, strategy_id, trade_date, underlying, contract, expiry,
               direction, lots, lot_size, entry_price, exit_price,
               entry_time, exit_time, leg, regime, is_rollover, source)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    %s::date, %s::date,
                    %s,%s, FALSE,'backtest')
            RETURNING id
        """, (
            cid, strategy_id, tr["trade_date"], tr["underlying"],
            tr["contract_expiry"], tr["expiry"], tr["direction"],
            lots, tr["lot_size"], tr["entry_price"], tr["exit_price"],
            tr["trade_date"], tr["expiry"],
            tr["leg"], tr["regime"],
        ))
        tid = cur.fetchone()[0]
        trade_ids_by_client[cid].append((tid, tr))

# Insert charges (full amounts — single client, no split)
for cid, trade_list in trade_ids_by_client.items():
    charge_rows = []
    for tid, tr in trade_list:
        charge_rows.append((
            tid,
            tr["stt_paise"], tr["exchange_paise"],
            tr["sebi_paise"], tr["stamp_paise"],
            tr["gst_paise"], tr["total_charges_paise"],
        ))
    execute_values(cur, """
        INSERT INTO trade_charges
          (trade_id, stt_paise, exchange_paise, sebi_paise,
           stamp_paise, gst_paise, total_paise)
        VALUES %s
        ON CONFLICT (trade_id) DO NOTHING
    """, charge_rows)

print(f"  Inserted {len(rows_out) * len(client_rows)} trade rows")

# Update latest trade date setting
cur.execute("""
    UPDATE platform_settings SET value=%s, updated_at=NOW()
    WHERE key='latest_trade_date'
""", (str(max(r["trade_date"] for r in rows_out)),))

conn.commit()
cur.close()
conn.close()
print("✅  DB seeded. pairdesk_dev is ready.")
