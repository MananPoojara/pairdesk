// In-process live market data from Angel One SmartAPI — the near-month FUTURES for NIFTY /
// MIDCAP SELECT / NIFTY BANK (not the spot index), so the futures pair is marked to its real
// contract price. The backend authenticates (TOTP), resolves the current futures tokens from the
// scrip master (refreshed daily / on rollover), fetches quotes (60s cache), and mirrors the last
// good snapshot to tickers.json for disk fallback (Render, restarts).
import crypto from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = join(HERE, 'tickers.json')

// Near-month index FUTURES (NFO / FUTIDX). Tokens change every expiry, so they're resolved
// dynamically from the Angel One scrip master by matching name + nearest non-expired monthly.
const SCRIP_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json'
const FUT_NAMES = { NIFTY: 'nifty', MIDCPNIFTY: 'midcap', BANKNIFTY: 'banknifty' }
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }
function parseExpiry(s) {                          // scrip master format e.g. "28JUL2026"
  const m = /^(\d{1,2})([A-Z]{3})(\d{4})$/.exec(String(s).toUpperCase())
  return m && MON[m[2]] != null ? Date.UTC(+m[3], MON[m[2]], +m[1]) : null
}

// ── TOTP (RFC 6238, SHA-1) via node crypto — no external dep ─────────────────────
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  s = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = ''
  const bytes = []
  for (const c of s) { const i = A.indexOf(c); if (i < 0) continue; bits += i.toString(2).padStart(5, '0') }
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
function totp(secret) {
  const key = base32Decode(secret)
  let counter = Math.floor(Date.now() / 1000 / 30)
  const buf = Buffer.alloc(8)
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256) }
  const h = crypto.createHmac('sha1', key).update(buf).digest()
  const off = h[h.length - 1] & 0xf
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff)
  return (bin % 1000000).toString().padStart(6, '0')
}

// ── credentials: prefer process.env (Render), else the root .env (local, gitignored) ────
let _creds = null
function creds() {
  if (_creds) return _creds
  const e = {}
  if (process.env.ANGEL_ONE_TOTP_SECRET) Object.assign(e, process.env)
  else {
    for (const rel of ['../../../../../.env', '../../../../.env', '../../../.env']) {
      try {
        const txt = readFileSync(join(HERE, rel), 'utf8')
        for (const line of txt.split('\n')) {
          const l = line.trim()
          if (!l || l.startsWith('#') || !l.includes('=')) continue
          const i = l.indexOf('=')
          const k = l.slice(0, i).trim().replace('export ', '')
          const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
          if (!(k in e)) e[k] = v
        }
        if (e.ANGEL_ONE_TOTP_SECRET) break
      } catch { /* try next candidate */ }
    }
  }
  _creds = e
  return e
}

function hdr(e) {
  return {
    'Content-Type': 'application/json', 'Accept': 'application/json',
    'X-UserType': 'USER', 'X-SourceID': 'WEB',
    'X-ClientLocalIP': e.LOCAL_IP || '127.0.0.1',
    'X-ClientPublicIP': e.PUBLIC_IP || '127.0.0.1',
    'X-MACAddress': e.MAC_ADDRESS || '00:00:00:00:00:00',
    'X-PrivateKey': e.ANGEL_ONE_API_KEY_NEW || e.ANGEL_ONE_API_KEY_OLD,
  }
}

// ── auth (jwt cached ~50 min) ────────────────────────────────────────────────────
let _jwt = null, _jwtAt = 0
async function login() {
  const e = creds()
  if (!e.ANGEL_ONE_TOTP_SECRET || !e.ANGEL_ONE_BASE_URL) throw new Error('angel one creds missing')
  const base = e.ANGEL_ONE_BASE_URL.replace(/\/$/, '')
  const r = await fetch(`${base}/rest/auth/angelbroking/user/v1/loginByPassword`, {
    method: 'POST', headers: hdr(e),
    body: JSON.stringify({ clientcode: e.ANGEL_ONE_CLIENT_CODE, password: e.ANGEL_ONE_MPIN, totp: totp(e.ANGEL_ONE_TOTP_SECRET) }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await r.json()
  const jwt = j?.data?.jwtToken
  if (!jwt) throw new Error(`login failed: ${j?.message} / ${j?.errorcode}`)
  _jwt = jwt; _jwtAt = Date.now()
  return jwt
}

// ── near-month futures tokens (scrip master; cached per-day, re-resolved on rollover) ────
let _futTok = null, _futDay = null
async function resolveFutTokens() {
  const now = new Date()
  const dayKey = now.toISOString().slice(0, 10)
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  // Reuse if resolved today AND every near-month contract is still un-expired.
  if (_futTok && _futDay === dayKey && Object.values(_futTok).every(v => v.expiryMs >= todayMs)) return _futTok
  const r = await fetch(SCRIP_URL, { signal: AbortSignal.timeout(30000) })
  const all = await r.json()
  const picked = {}
  for (const it of all) {
    if (it.exch_seg !== 'NFO' || it.instrumenttype !== 'FUTIDX') continue
    const key = FUT_NAMES[it.name]; if (!key) continue
    const ms = parseExpiry(it.expiry); if (ms == null || ms < todayMs) continue   // skip expired
    if (!picked[key] || ms < picked[key].expiryMs) picked[key] = { token: String(it.token), symbol: it.symbol, expiry: it.expiry, expiryMs: ms }
  }
  if (!picked.nifty || !picked.midcap || !picked.banknifty) throw new Error('futures token resolution incomplete')
  _futTok = picked; _futDay = dayKey
  return picked
}

// ── quote (result cached 60s; concurrent callers share one in-flight fetch) ──────
let _quote = null, _quoteAt = 0, _inflight = null
const TTL = 60_000

async function doFetch() {
  const e = creds()
  const base = e.ANGEL_ONE_BASE_URL.replace(/\/$/, '')
  if (!_jwt || Date.now() - _jwtAt > 50 * 60_000) await login()
  const fut = await resolveFutTokens()
  const tokenKey = {}                                          // scrip token -> nifty|midcap|banknifty
  for (const key of ['nifty', 'midcap', 'banknifty']) tokenKey[fut[key].token] = key
  const q = await fetch(`${base}/rest/secure/angelbroking/market/v1/quote/`, {
    method: 'POST', headers: { ...hdr(e), Authorization: `Bearer ${_jwt}` },
    body: JSON.stringify({ mode: 'FULL', exchangeTokens: { NFO: Object.keys(tokenKey) } }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await q.json()
  const fetched = j?.data?.fetched
  if (!fetched?.length) throw new Error(`quote failed: ${j?.message} / ${j?.errorcode}`)
  const now = new Date()
  const out = { updated: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}` }
  for (const it of fetched) {
    const k = tokenKey[String(it.symbolToken)]
    if (k) out[k] = {
      ltp: Math.round((+it.ltp || 0) * 100) / 100,
      change: Math.round((+it.netChange || 0) * 100) / 100,
      pct: Math.round((+it.percentChange || 0) * 100) / 100,
      prev_close: Math.round(((+it.close) || (+it.ltp - +it.netChange) || 0) * 100) / 100,
      oi: +it.opnInterest || 0,                                // open interest (futures-only)
      contract: fut[k].symbol,                                 // e.g. NIFTY28JUL26FUT
      expiry: fut[k].expiry,
      date: (it.exchFeedTime || '').slice(0, 11).trim(),
    }
  }
  _quote = out; _quoteAt = Date.now()
  try { writeFileSync(SNAPSHOT_PATH, JSON.stringify(out, null, 2)) } catch { /* read-only fs on Render — ignore */ }
  return out
}

// Returns { updated, nifty:{ltp,change,pct,prev_close}, midcap:{...}, banknifty:{...} } or the last
// good snapshot from disk. Never throws — callers get null-safe data and can fall back further.
export async function getLiveMarket() {
  if (_quote && Date.now() - _quoteAt < TTL) return _quote
  if (_inflight) return _inflight
  _inflight = doFetch()
    .catch(err => {
      console.warn('[liveMarket] fetch failed:', err.message)
      if (_quote) return _quote                       // in-memory stale
      try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) } catch { return null }  // disk fallback
    })
    .finally(() => { _inflight = null })
  return _inflight
}

// Synchronous last-known snapshot (disk) — for callers that can't await (kept for compatibility).
export function readSnapshot() {
  if (_quote) return _quote
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) } catch { return null }
}
