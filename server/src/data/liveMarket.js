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
    'X-PrivateKey': e.ANGEL_ONE_API_KEY_NEW || e.ANGEL_ONE_API_KEY_OLD || e.ANGEL_ONE_API_KEY,
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

// ── near-month futures tokens ────────────────────────────────────────────────────
// The scrip master is a 34MB download that can take 30-40s on a slow link. To keep it OFF the
// quote path, resolved tokens are persisted to disk and reused across restarts; a day-old cache
// is still valid (tokens only change at monthly expiry), and a stale cache is refreshed in the
// BACKGROUND so the price fetch never blocks on the big download.
const FUT_TOKENS_PATH = join(HERE, 'fut_tokens.json')
let _futTok = null, _futDay = null, _futRefreshing = false
const todayMs = () => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) }
const dayKey = () => new Date().toISOString().slice(0, 10)
const futValid = t => t && ['nifty', 'midcap', 'banknifty'].every(k => t[k] && t[k].expiryMs >= todayMs())

async function downloadFutTokens() {
  const r = await fetch(SCRIP_URL, { signal: AbortSignal.timeout(60000) })
  const all = await r.json()
  const t = todayMs(), picked = {}
  for (const it of all) {
    if (it.exch_seg !== 'NFO' || it.instrumenttype !== 'FUTIDX') continue
    const key = FUT_NAMES[it.name]; if (!key) continue
    const ms = parseExpiry(it.expiry); if (ms == null || ms < t) continue          // skip expired
    if (!picked[key] || ms < picked[key].expiryMs) picked[key] = { token: String(it.token), symbol: it.symbol, expiry: it.expiry, expiryMs: ms }
  }
  if (!picked.nifty || !picked.midcap || !picked.banknifty) throw new Error('futures token resolution incomplete')
  _futTok = picked; _futDay = dayKey()
  try { writeFileSync(FUT_TOKENS_PATH, JSON.stringify({ day: _futDay, tokens: picked })) } catch { /* read-only fs — ignore */ }
  return picked
}
function refreshFutInBackground() {
  if (_futRefreshing || _futDay === dayKey()) return
  _futRefreshing = true
  downloadFutTokens().catch(e => console.warn('[liveMarket] fut token refresh failed:', e.message)).finally(() => { _futRefreshing = false })
}
async function resolveFutTokens() {
  if (futValid(_futTok)) { if (_futDay !== dayKey()) refreshFutInBackground(); return _futTok }   // in-memory
  try {                                                                                            // disk
    const disk = JSON.parse(readFileSync(FUT_TOKENS_PATH, 'utf8'))
    if (futValid(disk?.tokens)) { _futTok = disk.tokens; _futDay = disk.day; if (_futDay !== dayKey()) refreshFutInBackground(); return _futTok }
  } catch { /* no/invalid disk cache */ }
  return downloadFutTokens()                                                                       // first run / expired: must download now
}

// ── quote — fetched on a WALL-CLOCK minute schedule (see startMinuteScheduler) so the shown
// price is each 1-minute candle's close. API requests just read this cache; the scheduler is the
// only regular fetcher (~1 broker call/min at HH:MM:00). STALE_MS is a safety fallback for
// requests that arrive before the scheduler has run (startup) or if it ever stalls.
let _quote = null, _quoteAt = 0, _inflight = null
const STALE_MS = 90_000

async function doFetch() {
  const e = creds()
  const base = e.ANGEL_ONE_BASE_URL.replace(/\/$/, '')
  if (!_jwt || Date.now() - _jwtAt > 50 * 60_000) await login()
  const fut = await resolveFutTokens()
  const tokenKey = {}                                          // scrip token -> nifty|midcap|banknifty
  for (const key of ['nifty', 'midcap', 'banknifty']) tokenKey[fut[key].token] = key
  // NSE index SPOT tokens (stable — don't change with expiry). Fetched alongside the futures so the
  // ticker bar can show spot while the rest of the app keeps using the futures LTP.
  const spotKey = { '99926000': 'nifty', '99926074': 'midcap', '99926009': 'banknifty' }
  const q = await fetch(`${base}/rest/secure/angelbroking/market/v1/quote/`, {
    method: 'POST', headers: { ...hdr(e), Authorization: `Bearer ${_jwt}` },
    body: JSON.stringify({ mode: 'FULL', exchangeTokens: { NFO: Object.keys(tokenKey), NSE: Object.keys(spotKey) } }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await q.json()
  const fetched = j?.data?.fetched
  if (!fetched?.length) throw new Error(`quote failed: ${j?.message} / ${j?.errorcode}`)
  const r2 = x => Math.round((+x || 0) * 100) / 100
  const now = new Date()
  const out = { updated: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}` }
  const spots = {}
  for (const it of fetched) {
    const sk = spotKey[String(it.symbolToken)]
    if (sk) spots[sk] = { ltp: r2(it.ltp), change: r2(it.netChange), pct: r2(it.percentChange) }
  }
  for (const it of fetched) {
    const k = tokenKey[String(it.symbolToken)]
    if (k) out[k] = {
      ltp: r2(it.ltp),
      change: r2(it.netChange),
      pct: r2(it.percentChange),
      prev_close: r2((+it.close) || (+it.ltp - +it.netChange) || 0),
      oi: +it.opnInterest || 0,                                // open interest (futures-only)
      contract: fut[k].symbol,                                 // e.g. NIFTY28JUL26FUT
      expiry: fut[k].expiry,
      date: (it.exchFeedTime || '').slice(0, 11).trim(),
      spot: spots[k] || null,                                  // NSE index spot (for the ticker bar)
    }
  }
  _quote = out; _quoteAt = Date.now()
  try { writeFileSync(SNAPSHOT_PATH, JSON.stringify(out, null, 2)) } catch { /* read-only fs on Render — ignore */ }
  return out
}

// One in-flight fetch shared by concurrent callers; never throws (falls back to stale / disk).
function fetchNow() {
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

// Returns the latest minute-close quote (kept fresh by the scheduler). Falls back to an on-demand
// fetch only if the cache is missing or has gone stale (> STALE_MS). Never throws.
export async function getLiveMarket() {
  if (_quote && Date.now() - _quoteAt < STALE_MS) return _quote
  return fetchNow()
}

// ── wall-clock minute scheduler ──────────────────────────────────────────────────
// Fires just after each HH:MM:00 boundary so the fetched LTP is that minute's close (lands in the
// :59→:01 window). Re-aligns every tick (no setInterval drift) and is independent of restart time
// (a 10:34:20 restart still fetches at 10:35:00, 10:36:00, …). Epoch-ms minute boundaries line up
// with IST minute boundaries (the +5:30 offset is a whole number of minutes).
let _schedTimer = null
function scheduleTick() {
  const msToNext = 60_000 - (Date.now() % 60_000)
  _schedTimer = setTimeout(() => { fetchNow().catch(() => {}); scheduleTick() }, msToNext + 250)
  if (_schedTimer.unref) _schedTimer.unref()          // don't keep the process alive on its own
}
export function startMinuteScheduler() {
  if (_schedTimer) return
  fetchNow().then(() => console.log('[liveMarket] pre-warmed')).catch(() => {})   // immediate warm
  scheduleTick()
}

// Synchronous last-known snapshot (disk) — for callers that can't await (kept for compatibility).
export function readSnapshot() {
  if (_quote) return _quote
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) } catch { return null }
}
