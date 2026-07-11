# PairDesk

A client-facing showcase desk for **Young Turtle's** market-neutral pair-trading
strategy — **Nifty Midcap Select × Nifty 50**. It presents the live book
(orders, positions, per-client P&L) alongside backtested strategy **variants**
(Options and BankNifty), with performance panels, per-trade blotters, and
per-client breakdowns.

All performance figures are computed on the deployed capital base (₹30 Cr) and
scaled per client, so the ₹ and % always reconcile.

## Stack

| Layer     | Tech                                   | Local port |
|-----------|----------------------------------------|-----------|
| Frontend  | React + Vite                           | `5173`    |
| Backend   | Node + Fastify (`node --watch`)        | `3002`    |
| Database  | PostgreSQL 16                          | `5433`    |

The browser only ever talks to `:5173`; Vite proxies `/api` → the backend on
`:3002` (see `web/vite.config.js`), so on a LAN only `:5173` needs to be
reachable.

## Repository layout

```
web/        React + Vite frontend
  src/pages/    Dashboard, Strategies, Clients, Orders, History, ...
  src/lib/      chart/stat helpers, variantData.js, variantTrades.js
server/     Fastify API
  src/routes/   dashboard, clients, strategies, orders, ...
  src/db/pg.js  Postgres pool (DATABASE_URL in prod, Docker fallback locally)
db/schema.sql   Phase-1 schema (money as NUMERIC/paise, append-only trades)
Data/           P&L ingest + parquet market data (Python)
docker-compose.yml  Local Postgres
```

## Local development

**1. Start Postgres** (Docker):

```bash
docker compose up -d          # postgres:16 on :5433 (db pairdesk_dev)
psql "postgresql://pairdesk:pairdesk2026@127.0.0.1:5433/pairdesk_dev" -f db/schema.sql
```

The P&L / market data pipeline lives in `Data/` (`ingest_pnl.py`,
`build_parquet.py`).

**2. Backend** (`server/`):

```bash
cd server
npm install
npm run dev                   # Fastify on :3002, hot-reload via node --watch
```

Locally the server falls back to the Docker Postgres above. In production set
`DATABASE_URL` (Neon/Render, SSL required) — see `server/src/db/pg.js`.

**3. Frontend** (`web/`):

```bash
cd web
npm install
npm run dev                   # Vite on :5173 (proxies /api → :3002)
```

Open http://localhost:5173.

## Build

```bash
cd web && npm run build       # production bundle in web/dist
cd server && npm start        # serve the API
```

## Deployment

- **Frontend** → Vercel
- **Backend** → Render (`pairdesk.onrender.com`)
- **Database** → Neon (cloud Postgres, `DATABASE_URL` with SSL)

Both the Vercel and Render deploys auto-build on push to `main`.

## Strategy variants

The Dashboard, Strategies, and Clients pages have a **Fut/Options** instrument
toggle and a **BankNifty** index chip. Selecting a variant swaps the performance
panels to hardcoded, source-verified backtest data (`web/src/lib/variantData.js`
for monthly aggregates, `web/src/lib/variantTrades.js` for the per-trade
blotters). The live book, positions, and orders always stay live. Variant views
are clearly labelled **spot-backtested** (Options/BankNifty) or **indicative**
(single-leg views) — never presented as live execution.

---

Built with [Claude Code](https://claude.com/claude-code).
