// In-process live market data from Angel One SmartAPI — NIFTY 50 / MIDCAP SELECT / NIFTY BANK.
// Replaces the old standalone Python daemon: the backend authenticates (TOTP) and fetches quotes
// itself, caching for 60s and mirroring the last good snapshot to tickers.json for disk fallback
// (used on Render, where Angel One creds/network may be absent, and across restarts).
import crypto from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = join(HERE, 'tickers.json')

// NSE index tokens
const TOKENS = { '99926000': 'nifty', '99926009': 'banknifty', '99926074': 'midcap' }

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

// ── quote (result cached 60s; concurrent callers share one in-flight fetch) ──────
let _quote = null, _quoteAt = 0, _inflight = null
const TTL = 60_000

async function doFetch() {
  const e = creds()
  const base = e.ANGEL_ONE_BASE_URL.replace(/\/$/, '')
  if (!_jwt || Date.now() - _jwtAt > 50 * 60_000) await login()
  const q = await fetch(`${base}/rest/secure/angelbroking/market/v1/quote/`, {
    method: 'POST', headers: { ...hdr(e), Authorization: `Bearer ${_jwt}` },
    body: JSON.stringify({ mode: 'FULL', exchangeTokens: { NSE: Object.keys(TOKENS) } }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await q.json()
  const fetched = j?.data?.fetched
  if (!fetched?.length) throw new Error(`quote failed: ${j?.message} / ${j?.errorcode}`)
  const now = new Date()
  const out = { updated: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}` }
  for (const it of fetched) {
    const k = TOKENS[String(it.symbolToken)]
    if (k) out[k] = {
      ltp: Math.round((+it.ltp || 0) * 100) / 100,
      change: Math.round((+it.netChange || 0) * 100) / 100,
      pct: Math.round((+it.percentChange || 0) * 100) / 100,
      prev_close: Math.round(((+it.close) || (+it.ltp - +it.netChange) || 0) * 100) / 100,
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
