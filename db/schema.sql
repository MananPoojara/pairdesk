-- PairDesk Phase 1 Schema
-- Money: NUMERIC(20,4) throughout. Never float.
-- Append-only: trades never updated, only inserted.

-- ── Clients ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,           -- e.g. "ASHFORD"
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('Retail','HNI','Institution')),
  aum_paise     BIGINT NOT NULL DEFAULT 0,      -- money in paise (1 INR = 100 paise)
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Strategies ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategies (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,           -- e.g. "MIDCAP_NIFTY_PAIR"
  name          TEXT NOT NULL,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Client ↔ Strategy mapping ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_strategies (
  id              SERIAL PRIMARY KEY,
  client_id       INT NOT NULL REFERENCES clients(id),
  strategy_id     INT NOT NULL REFERENCES strategies(id),
  allocation_paise BIGINT NOT NULL DEFAULT 0,   -- capital allocated to this strategy
  exposure_paise  BIGINT NOT NULL DEFAULT 0,    -- exposure assigned to this strategy
  leverage        NUMERIC(10,4) NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at       DATE NOT NULL,
  UNIQUE (client_id, strategy_id)
);

-- ── Trades (append-only, double-entry pair) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id              BIGSERIAL PRIMARY KEY,
  client_id       INT NOT NULL REFERENCES clients(id),
  strategy_id     INT NOT NULL REFERENCES strategies(id),
  trade_date      DATE NOT NULL,
  underlying      TEXT NOT NULL,               -- NIFTY | MIDCPNIFTY
  contract        TEXT NOT NULL,               -- e.g. NIFTY26JUNFUT
  expiry          DATE NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
  lots            INT NOT NULL,
  lot_size        INT NOT NULL,                -- 25 for NIFTY, 50 for MIDCPNIFTY
  entry_price     NUMERIC(20,4) NOT NULL,
  exit_price      NUMERIC(20,4),               -- NULL = open position
  entry_time      TIMESTAMPTZ NOT NULL,
  exit_time       TIMESTAMPTZ,
  leg             TEXT NOT NULL CHECK (leg IN ('BULL','BEAR')),
  regime          TEXT NOT NULL CHECK (regime IN ('BULL','BEAR')),
  is_rollover     BOOLEAN NOT NULL DEFAULT FALSE,
  source          TEXT NOT NULL DEFAULT 'backtest'  -- backtest | live
);

CREATE INDEX IF NOT EXISTS trades_date_idx ON trades(trade_date);
CREATE INDEX IF NOT EXISTS trades_client_idx ON trades(client_id);
CREATE INDEX IF NOT EXISTS trades_underlying_idx ON trades(underlying);

-- ── Per-trade charges (mirrors Excel Total Expense breakdown) ─────────────────
CREATE TABLE IF NOT EXISTS trade_charges (
  trade_id        BIGINT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  stt_paise       BIGINT NOT NULL DEFAULT 0,
  exchange_paise  BIGINT NOT NULL DEFAULT 0,
  sebi_paise      BIGINT NOT NULL DEFAULT 0,
  stamp_paise     BIGINT NOT NULL DEFAULT 0,
  gst_paise       BIGINT NOT NULL DEFAULT 0,
  brokerage_paise BIGINT NOT NULL DEFAULT 0,
  total_paise     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (trade_id)
);

-- ── Daily PnL snapshot (read model — recomputed by engine) ───────────────────
CREATE TABLE IF NOT EXISTS daily_pnl (
  pnl_date        DATE NOT NULL,
  client_id       INT NOT NULL REFERENCES clients(id),
  strategy_id     INT NOT NULL REFERENCES strategies(id),
  realised_paise  BIGINT NOT NULL DEFAULT 0,
  unrealised_paise BIGINT NOT NULL DEFAULT 0,
  charges_paise   BIGINT NOT NULL DEFAULT 0,
  net_paise       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (pnl_date, client_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS daily_pnl_date_idx ON daily_pnl(pnl_date);

-- ── Open positions (current state — upserted by engine) ──────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id              BIGSERIAL PRIMARY KEY,
  client_id       INT NOT NULL REFERENCES clients(id),
  strategy_id     INT NOT NULL REFERENCES strategies(id),
  underlying      TEXT NOT NULL,
  contract        TEXT NOT NULL,
  expiry          DATE NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
  lots            INT NOT NULL,
  lot_size        INT NOT NULL,
  avg_price       NUMERIC(20,4) NOT NULL,
  current_price   NUMERIC(20,4),
  leg             TEXT NOT NULL CHECK (leg IN ('BULL','BEAR')),
  regime          TEXT NOT NULL CHECK (regime IN ('BULL','BEAR')),
  opened_at       DATE NOT NULL,
  UNIQUE (client_id, strategy_id, underlying, contract, direction)
);

-- ── Platform settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default settings
INSERT INTO platform_settings (key, value) VALUES
  ('default_exposure_pct', '50'),     -- 50% of AUM per leg
  ('default_leverage', '2'),
  ('replay_mode', 'backtest'),        -- backtest | live
  ('latest_trade_date', '2026-02-24') -- updated by engine on ingest
ON CONFLICT (key) DO NOTHING;
