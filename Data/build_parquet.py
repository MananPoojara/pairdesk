#!/usr/bin/env python3
"""Build the three parquet foundations for PairDesk from the raw CSVs.
  spot_bars.parquet       <- SpotData (NIFTY 50, NIFTY MID SELECT)  -> backtest
  fut_bars.parquet        <- per-contract MIDCAP_FUT + NIFTY_FUT     -> execution truth / rollover
  fut_continuous.parquet  <- F1 continuous (NIFTY_F1, MIDCPNIFTY_F1) -> chart marking between rolls
"""
import pandas as pd, glob, os, sys, time

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(ROOT, "parquet"); os.makedirs(OUT, exist_ok=True)

NUM = ["Open","High","Low","Close"]
def load_csv(path):
    """Schema-tolerant loader. Handles 3 header variants:
       A: Ticker,Date,Time,Expiry Date,OHLC,Volume,Open Interest,Padding Flag
       B: Date,Time,ExpiryDate,Symbol,StrikePrice,OptionType,OHLC,...   (no Ticker)
       C: Date,Time,Expiry Date,OHLC,...                                (no Ticker)"""
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    stem = os.path.splitext(os.path.basename(path))[0]
    def col(*names):  # first matching column name
        for n in names:
            if n in df.columns: return n
        return None
    exp_col = col("Expiry Date","ExpiryDate")
    vol_col = col("Volume","Contracts")
    oi_col  = col("Open Interest","OpenInterest")
    pad_col = col("Padding Flag","PaddingFlag")
    df["datetime"] = pd.to_datetime(df["Date"].astype(str)+" "+df["Time"].astype(str),
                                    format="%Y-%m-%d %H:%M:%S", errors="coerce")
    df["date"]   = pd.to_datetime(df["Date"], errors="coerce").dt.date
    df["expiry"] = pd.to_datetime(df[exp_col], errors="coerce").dt.date if exp_col else pd.NaT
    for c in NUM: df[c] = pd.to_numeric(df[c], errors="coerce").astype("float32")
    df["Volume"] = pd.to_numeric(df[vol_col], errors="coerce").fillna(0).astype("int64") if vol_col else 0
    df["OI"]     = pd.to_numeric(df[oi_col],  errors="coerce").fillna(0).astype("int64") if oi_col else 0
    df["padding"]= pd.to_numeric(df[pad_col], errors="coerce").fillna(0).astype("int8")  if pad_col else 0
    df["ticker"] = df["Ticker"].astype(str) if "Ticker" in df.columns else stem
    df["_stem"]  = stem
    return df

def std(df, extra):
    keep = ["datetime","date","expiry","Open","High","Low","Close","Volume","OI","padding","ticker"]
    out = df[keep].rename(columns={"Open":"open","High":"high","Low":"low","Close":"close","Volume":"volume"})
    for k,v in extra.items(): out[k]=v
    return out

def build_spot():
    files = {"NIFTY 50":"NIFTY", "NIFTY MID SELECT":"MIDCPNIFTY"}
    parts=[]
    for fn in ["NIFTY 50.csv","NIFTYMIDSELECT.csv"]:
        p=os.path.join(ROOT,"SpotData",fn)
        df=load_csv(p); tick=df["ticker"].iloc[0]
        und = "NIFTY" if "NIFTY 50" in tick else "MIDCPNIFTY"
        parts.append(std(df, {"underlying":und}))
        print(f"  spot {fn}: {len(df):,} rows {df['date'].min()}→{df['date'].max()}")
    out=pd.concat(parts, ignore_index=True).sort_values(["underlying","datetime"])
    out["underlying"]=out["underlying"].astype("category")
    path=os.path.join(OUT,"spot_bars.parquet"); out.to_parquet(path, compression="zstd", index=False)
    print(f"  -> spot_bars.parquet  {len(out):,} rows  {os.path.getsize(path)/1e6:.1f} MB")

def build_fut():
    parts=[]; n=0
    for folder,und in [("MIDCAP_FUT","MIDCPNIFTY"),("NIFTY_FUT","NIFTY")]:
        for p in sorted(glob.glob(os.path.join(ROOT,folder,"*.csv"))):
            try:
                df=load_csv(p); contract=df["_stem"].iloc[0]
                parts.append(std(df, {"underlying":und, "contract":contract})); n+=1
            except Exception as e:
                print(f"    !! {os.path.basename(p)}: {e}")
    out=pd.concat(parts, ignore_index=True).sort_values(["underlying","expiry","datetime"])
    out["underlying"]=out["underlying"].astype("category"); out["contract"]=out["contract"].astype("category")
    path=os.path.join(OUT,"fut_bars.parquet"); out.to_parquet(path, compression="zstd", index=False)
    print(f"  -> fut_bars.parquet   {len(out):,} rows  {n} contracts  {os.path.getsize(path)/1e6:.1f} MB")

def build_cont():
    parts=[]
    for fn,und in [("NIFTY_F1.csv","NIFTY"),("MIDCPNIFTY_F1.csv","MIDCPNIFTY")]:
        p=os.path.join(ROOT,fn); df=load_csv(p)
        parts.append(std(df, {"underlying":und}))
        print(f"  cont {fn}: {len(df):,} rows {df['date'].min()}→{df['date'].max()}")
    out=pd.concat(parts, ignore_index=True).sort_values(["underlying","datetime"])
    out["underlying"]=out["underlying"].astype("category")
    path=os.path.join(OUT,"fut_continuous.parquet"); out.to_parquet(path, compression="zstd", index=False)
    print(f"  -> fut_continuous.parquet {len(out):,} rows  {os.path.getsize(path)/1e6:.1f} MB")

if __name__=="__main__":
    t=time.time()
    print("[1/3] spot_bars ..."); build_spot()
    print("[2/3] fut_bars ...");  build_fut()
    print("[3/3] fut_continuous ..."); build_cont()
    print(f"done in {time.time()-t:.1f}s -> {OUT}")
