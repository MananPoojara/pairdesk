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
  brokerage_pct NUMERIC(8,4) NOT NULL DEFAULT 0, -- per-client brokerage rate (%)
  tax_pct       NUMERIC(8,4) NOT NULL DEFAULT 0, -- per-client tax rate (%)
  exec_type     TEXT NOT NULL DEFAULT 'F2F',     -- F2F (fut×fut pair) | F2O (fut×option pair)
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
  cash_paise      BIGINT NOT NULL DEFAULT 0,    -- cash share of allocation (base for Return-on-Cash)
  pledge_paise    BIGINT NOT NULL DEFAULT 0,    -- stock-pledge share of allocation (cash + pledge = allocation)
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

-- ── Option (F2O) trade book — the fut×option pair (Master Club 4.1 combined) ──
-- Separate from `trades` (which is the futures F2F book). Populated by Data/ingest_options.py.
-- Each row = one weekly trade: Nifty option leg (SELL CE/PE) + Midcap hypothetical-future leg.
-- Charges not itemised yet (to be added); P&L carried as points + % of NAV (additive contributor).
CREATE TABLE IF NOT EXISTS option_trades (
  id                   BIGSERIAL PRIMARY KEY,
  trade_no             INT,
  phase                TEXT NOT NULL,               -- source strategy (1st Month/XTROC/TROC/M5DP/Bear Short)
  entry_date           DATE NOT NULL,
  exit_date            DATE,
  expiry               DATE NOT NULL,
  opt_type             TEXT,                        -- CE | PE
  strike               NUMERIC(20,4),
  buy_sell             TEXT,                        -- SELL | BUY (option leg)
  qty                  INT,
  opt_entry_px         NUMERIC(20,4),               -- option premium at entry
  opt_exit_px          NUMERIC(20,4),               -- option premium at exit
  opt_pnl_pts          NUMERIC(20,4),               -- option leg P&L (points)
  midcap_entry_spot    NUMERIC(20,4),
  midcap_exit_spot     NUMERIC(20,4),
  midcap_hypo_pnl_pts  NUMERIC(20,4),               -- spot-adjusted, futures-equivalent
  combined_pnl_pts     NUMERIC(20,4),
  combined_pnl_pct     NUMERIC(20,10),              -- % of NAV (base 100) — additive contributor
  exit_reason          TEXT,
  source               TEXT NOT NULL DEFAULT 'option_backtest'
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

-- Effective-dated exchange lot sizes. Quantity engines select the latest row whose
-- date is on or before the contract expiry, so admin changes affect sizing immediately.
CREATE TABLE IF NOT EXISTS lot_size_history (
  id              BIGSERIAL PRIMARY KEY,
  underlying      TEXT NOT NULL CHECK (underlying IN ('NIFTY','MIDCPNIFTY')),
  effective_date  DATE NOT NULL,
  lot_size        INT NOT NULL CHECK (lot_size > 0 AND lot_size <= 10000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (underlying, effective_date)
);

INSERT INTO lot_size_history (underlying, effective_date, lot_size) VALUES
  ('NIFTY', '1900-01-01', 25),
  ('NIFTY', '2024-11-20', 75),
  ('NIFTY', '2025-12-30', 65),
  ('MIDCPNIFTY', '1900-01-01', 50),
  ('MIDCPNIFTY', '2024-11-20', 120),
  ('MIDCPNIFTY', '2025-04-25', 140),
  ('MIDCPNIFTY', '2025-10-28', 120)
ON CONFLICT (underlying, effective_date) DO NOTHING;

-- Seed default settings
INSERT INTO platform_settings (key, value) VALUES
  ('default_exposure_pct', '50'),     -- 50% of AUM per leg
  ('default_leverage', '2'),
  ('replay_mode', 'backtest'),        -- backtest | live
  ('latest_trade_date', '2026-02-24'), -- updated by engine on ingest
  -- Futures charge rates (Admin-editable, see server/src/data/chargeConfig.js) — drives the OPEN
  -- cycle's live mark-to-market charges. Fractions of notional; gst is a fraction of exch+sebi.
  ('charge_exch_rate', '0.0000173'),
  ('charge_sebi_rate', '0.000001'),
  ('charge_stamp_rate', '0.0002'),
  ('charge_gst_rate', '0.18'),
  ('charge_stt_rate', '0.0005')
ON CONFLICT (key) DO NOTHING;
