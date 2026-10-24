#!/usr/bin/env python3
"""Monthly roll on PROD: close the open cycle, open the next one, from the 'P&L 30 Cr' sheet.
Touches only the pair-strategy trades of client TEST — roster/capital/options are left alone.
(Never run ingest_pnl.py on prod: it wipes all trades and deactivates the roster.)

  python3 Data/roll_month.py <close_date> <open_date> [--redo] [--apply]     # default = dry run
  e.g. python3 Data/roll_month.py 2026-08-25 2026-09-29 --apply
  --redo: the sheet was corrected after that roll was applied — undo it and re-roll.
"""
import os, re, sys, psycopg2
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
XL = os.path.join(HERE, "../../../Reference/MidCap + Nifty Pair Trading_Updated future 3-15.xlsx")
ENV = os.path.join(HERE, "../.deploy.env")
LEG = {"MIDCPNIFTY": ("BULL", 10), "NIFTY": ("BEAR", 5)}   # leg, lot_size — as stored in prod

close_d, open_d = sys.argv[1], sys.argv[2]
df = pd.read_excel(XL, sheet_name="P&L 30 Cr").dropna(subset=["Date "])
df.columns = [c.strip() for c in df.columns]
df["Date"] = pd.to_datetime(df["Date"]).dt.date.astype(str)
def row(d, sym):
    r = df[(df["Date"] == d) & (df["Symbol"] == sym)]
    assert len(r) == 1, (d, sym); return r.iloc[0]
p = lambda x: round(float(x) * 100) if pd.notna(x) else 0

url = re.search(r'DATABASE_URL\s*=\s*(.*)', open(ENV).read()).group(1).strip().strip('"\'').replace('\\&', '&').replace('\\', '')
url = re.sub(r'([?&])channel_binding=[^&]*&?', r'\1', url).rstrip('?&')   # same cleanup as migrate_neon.mjs
conn = psycopg2.connect(url, channel_binding="disable"); cur = conn.cursor()
cur.execute("SELECT id FROM clients WHERE code='TEST'"); cid = cur.fetchone()[0]

# --redo: sheet was corrected after a roll — undo that roll first (same transaction), then re-roll.
if "--redo" in sys.argv:
    cur.execute("DELETE FROM trades WHERE client_id=%s AND trade_date=%s AND exit_price IS NULL RETURNING id", (cid, open_d))
    print("redo: removed open legs", [x[0] for x in cur.fetchall()])
    cur.execute("""DELETE FROM trade_charges WHERE trade_id IN
                   (SELECT id FROM trades WHERE client_id=%s AND trade_date=%s)""", (cid, close_d))
    cur.execute("UPDATE trades SET exit_price=NULL, exit_time=NULL WHERE client_id=%s AND trade_date=%s RETURNING id", (cid, close_d))
    print("redo: reopened", [x[0] for x in cur.fetchall()])

# 1. close the open legs entered on close_d
for sym in LEG:
    r = row(close_d, sym); assert pd.notna(r["Exit Price"]), f"{sym} {close_d} has no exit in sheet"
    cur.execute("""SELECT id, lots*lot_size, direction, strategy_id, expiry FROM trades
                   WHERE client_id=%s AND trade_date=%s AND underlying=%s AND exit_price IS NULL""", (cid, close_d, sym))
    rs = cur.fetchall(); assert len(rs) == 1, rs
    tid, qty, dirn, sid, exp = rs[0]
    assert qty == int(r["Qty"]) and dirn == r["Trade Type"], (qty, dirn, r["Qty"])
    cur.execute("UPDATE trades SET entry_price=%s, exit_price=%s, exit_time=%s WHERE id=%s",
                (float(r["Entry Price"]), float(r["Exit Price"]), exp, tid))
    ch = [p(r[c]) for c in ("STT", "Exchange Fee", "SEBI Turnover fee", "Stanmp duty", "GST", "Total Expense")]
    cur.execute("""INSERT INTO trade_charges (trade_id, stt_paise, exchange_paise, sebi_paise, stamp_paise, gst_paise, total_paise)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""", (tid, *ch))
    gross = (float(r["Exit Price"]) - float(r["Entry Price"])) * qty * (1 if dirn == "LONG" else -1)
    net = gross - ch[-1] / 100
    assert abs(net - float(r["Net Profit"])) < 1, (net, r["Net Profit"])
    print(f"closed {tid} {sym} {r['Entry Price']}→{r['Exit Price']} net=₹{net:,.2f} (sheet ₹{r['Net Profit']:,.2f})")

# 2. open the new legs (no charge row — prod stores open legs that way)
for sym, (leg, lot) in LEG.items():
    r = row(open_d, sym); assert pd.isna(r["Exit Price"]), f"{sym} {open_d} should be open"
    qty = int(r["Qty"]); assert qty % lot == 0
    exp = pd.to_datetime(r["Expiry"]).date()
    cur.execute("SELECT count(*) FROM trades WHERE client_id=%s AND trade_date=%s AND underlying=%s", (cid, open_d, sym))
    assert cur.fetchone()[0] == 0, f"{sym} {open_d} already in DB"
    regime = "BULL" if (sym == "MIDCPNIFTY") == (r["Trade Type"] == "LONG") else "BEAR"
    cur.execute("""INSERT INTO trades (client_id, strategy_id, trade_date, underlying, contract, expiry, direction,
                     lots, lot_size, entry_price, exit_price, entry_time, exit_time, leg, regime, is_rollover, source)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, NULL, %s, %s, FALSE, 'backtest') RETURNING id""",
                (cid, sid, open_d, sym, f"{sym}{exp:%y%b}FUT".upper(), exp, r["Trade Type"],
                 qty // lot, lot, float(r["Entry Price"]), open_d, leg, regime))
    print(f"opened {cur.fetchone()[0]} {sym} {r['Trade Type']} {qty} @ {r['Entry Price']} exp {exp}")

cur.execute("UPDATE platform_settings SET value=%s, updated_at=NOW() WHERE key='latest_trade_date'", (open_d,))
cur.execute("""SELECT id, trade_date, underlying, direction, lots*lot_size, entry_price, exit_price, expiry, contract, regime
               FROM trades WHERE client_id=%s AND trade_date>=%s ORDER BY id""", (cid, close_d))
for x in cur.fetchall(): print(x)

if "--apply" in sys.argv: conn.commit(); print("COMMITTED")
else: conn.rollback(); print("DRY RUN — rolled back (add --apply to write)")
