#!/usr/bin/env python3
"""Fetch live/EOD index LTP (NIFTY 50, NIFTY BANK, NIFTY MIDCAP SELECT) from Angel One SmartAPI
into server/src/data/tickers.json for the header ticker bar. Creds in the root .env (gitignored).

  python3 Data/fetch_tickers.py            # one-shot (EOD refresh / cron)
  python3 Data/fetch_tickers.py --loop     # refresh every 60s (live header), re-auths hourly
"""
import os, json, sys, time, datetime
import requests, pyotp

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, "../../../.env")                 # /home/server/Downloads/PairTrading_algo/.env
OUT = os.path.join(HERE, "../server/src/data/tickers.json")
TOKENS = {"99926000": "nifty", "99926009": "banknifty", "99926074": "midcap"}

def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip().replace("export ", "")] = v.strip().strip('"').strip("'")
    return env

e = load_env(ENV)
BASE = e["ANGEL_ONE_BASE_URL"].rstrip("/")
API_KEY = e.get("ANGEL_ONE_API_KEY_NEW") or e.get("ANGEL_ONE_API_KEY_OLD")
HDR = {
    "Content-Type": "application/json", "Accept": "application/json",
    "X-UserType": "USER", "X-SourceID": "WEB",
    "X-ClientLocalIP": e.get("LOCAL_IP", "127.0.0.1"),
    "X-ClientPublicIP": e.get("PUBLIC_IP", "127.0.0.1"),
    "X-MACAddress": e.get("MAC_ADDRESS", "00:00:00:00:00:00"),
    "X-PrivateKey": API_KEY,
}

def login():
    totp = pyotp.TOTP(e["ANGEL_ONE_TOTP_SECRET"]).now()
    r = requests.post(f"{BASE}/rest/auth/angelbroking/user/v1/loginByPassword", headers=HDR,
                      json={"clientcode": e["ANGEL_ONE_CLIENT_CODE"], "password": e["ANGEL_ONE_MPIN"],
                            "totp": totp}, timeout=30)
    jwt = r.json().get("data", {}).get("jwtToken")
    if not jwt:
        raise RuntimeError(f"login failed: {r.json().get('message')} / {r.json().get('errorcode')}")
    return jwt

def fetch(jwt):
    q = requests.post(f"{BASE}/rest/secure/angelbroking/market/v1/quote/",
                      headers={**HDR, "Authorization": f"Bearer {jwt}"},
                      json={"mode": "FULL", "exchangeTokens": {"NSE": list(TOKENS)}}, timeout=30)
    fetched = q.json().get("data", {}).get("fetched", [])
    if not fetched:
        raise RuntimeError(f"quote failed: {q.json().get('message')} / {q.json().get('errorcode')}")
    out = {"updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")}
    for it in fetched:
        key = TOKENS.get(str(it.get("symbolToken")))
        if key:
            out[key] = {"ltp": round(float(it.get("ltp") or 0), 2),
                        "change": round(float(it.get("netChange") or 0), 2),
                        "pct": round(float(it.get("percentChange") or 0), 2),
                        "date": (it.get("exchFeedTime") or "")[:11].strip()}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=2)
    return out

def show(out):
    print("[%s] " % out["updated"] + " | ".join(
        f"{k.upper()} {out[k]['ltp']} ({out[k]['pct']:+}%)" for k in ("nifty", "midcap", "banknifty") if k in out))

if "--loop" in sys.argv:
    jwt = login(); last_auth = time.time()
    print("live loop started (60s)…  Ctrl-C to stop")
    while True:
        try:
            if time.time() - last_auth > 3000:      # re-auth ~every 50 min
                jwt = login(); last_auth = time.time()
            show(fetch(jwt))
        except Exception as ex:
            print("warn:", ex)
            try: jwt = login(); last_auth = time.time()
            except Exception as ex2: print("re-login failed:", ex2)
        time.sleep(60)
else:
    show(fetch(login()))
    print("wrote", OUT)
