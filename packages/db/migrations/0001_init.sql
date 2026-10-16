-- 0001_init — skema awal memebot (docs/03-architecture.md §6)
-- Semua waktu timestamptz (UTC). ht = Timescale hypertable.

-- ===================== master & trigger =====================
CREATE TABLE tokens (
  mint            text PRIMARY KEY,
  symbol          text,
  name            text,
  decimals        smallint,
  program         text CHECK (program IN ('spl', 'token2022')),
  launchpad       text,
  creator         text,
  created_at      timestamptz,
  migrated_at     timestamptz,
  pool_address    text,
  pool_kind       text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  first_source    text,
  metadata        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX tokens_first_seen_idx ON tokens (first_seen_at DESC);

CREATE TABLE token_triggers (
  id       bigint GENERATED ALWAYS AS IDENTITY,
  ts       timestamptz NOT NULL,
  mint     text NOT NULL,
  source   text NOT NULL,
  kind     text NOT NULL,
  payload  jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (ts, id)
);
SELECT create_hypertable('token_triggers', by_range('ts', INTERVAL '1 day'));
CREATE INDEX token_triggers_mint_idx ON token_triggers (mint, ts DESC);
CREATE INDEX token_triggers_source_idx ON token_triggers (source, kind, ts DESC);

CREATE TABLE token_snapshots (
  id               bigint GENERATED ALWAYS AS IDENTITY,
  ts               timestamptz NOT NULL,
  mint             text NOT NULL,
  provider         text NOT NULL,
  price_usd        numeric,
  mcap_usd         numeric,
  liquidity_usd    numeric,
  vol_5m           numeric,
  vol_1h           numeric,
  txns_5m          integer,
  holders          integer,
  top10_pct        numeric,
  dev_pct          numeric,
  bundler_pct      numeric,
  sniper_pct       numeric,
  insider_pct      numeric,
  fresh_wallet_pct numeric,
  organic_score    numeric,
  smart_money_cnt  integer,
  kol_cnt          integer,
  raw              jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (ts, id)
);
SELECT create_hypertable('token_snapshots', by_range('ts', INTERVAL '1 day'));
CREATE INDEX token_snapshots_mint_idx ON token_snapshots (mint, ts DESC);

CREATE TABLE security_reports (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts                  timestamptz NOT NULL DEFAULT now(),
  mint                text NOT NULL,
  mint_authority      text,
  freeze_authority    text,
  extensions          jsonb NOT NULL DEFAULT '[]',
  lp_status           jsonb,
  sell_sim            jsonb,
  roundtrip_loss_pct  numeric,
  rugcheck            jsonb,
  verdict             text NOT NULL CHECK (verdict IN ('pass', 'fail')),
  reasons             text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX security_reports_mint_idx ON security_reports (mint, ts DESC);

-- ===================== konfigurasi & keputusan =====================
CREATE TABLE config_versions (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('strategy', 'trade', 'sources', 'llm')),
  author      text NOT NULL CHECK (author IN ('user', 'llm', 'system')),
  hash        text NOT NULL,
  yaml        text NOT NULL,
  diff        text,
  note        text,
  active      boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX config_versions_kind_hash_idx ON config_versions (kind, hash);
CREATE UNIQUE INDEX config_versions_one_active_idx ON config_versions (kind) WHERE active;

CREATE TABLE decisions (
  id              bigint GENERATED ALWAYS AS IDENTITY,
  ts              timestamptz NOT NULL,
  mint            text NOT NULL,
  profile         text NOT NULL,
  stage           text NOT NULL CHECK (stage IN ('filter', 'security', 'mtf', 'score', 'risk')),
  passed          boolean NOT NULL,
  failed_rules    text[] NOT NULL DEFAULT '{}',
  features        jsonb NOT NULL DEFAULT '{}',
  score           numeric,
  config_version  integer REFERENCES config_versions (id),
  PRIMARY KEY (ts, id)
);
SELECT create_hypertable('decisions', by_range('ts', INTERVAL '1 day'));
CREATE INDEX decisions_mint_idx ON decisions (mint, ts DESC);
CREATE INDEX decisions_profile_idx ON decisions (profile, stage, passed, ts DESC);

-- ===================== data pasar =====================
CREATE TABLE trades_raw (
  ts            timestamptz NOT NULL,
  mint          text NOT NULL,
  slot          bigint,
  signature     text,
  side          text NOT NULL CHECK (side IN ('buy', 'sell')),
  sol_amount    double precision NOT NULL,
  token_amount  double precision NOT NULL,
  price_sol     double precision NOT NULL,
  trader        text,
  pool          text,
  source        text NOT NULL
);
SELECT create_hypertable('trades_raw', by_range('ts', INTERVAL '6 hours'));
CREATE INDEX trades_raw_mint_idx ON trades_raw (mint, ts DESC);

CREATE TABLE ticks (
  ts             timestamptz NOT NULL,
  mint           text NOT NULL,
  price_sol      double precision NOT NULL,
  price_usd      double precision,
  mcap_usd       double precision,
  liquidity_sol  double precision,
  source         text NOT NULL
);
SELECT create_hypertable('ticks', by_range('ts', INTERVAL '6 hours'));
CREATE INDEX ticks_mint_idx ON ticks (mint, ts DESC);

-- Candle multi-timeframe dari trades_raw (continuous aggregates, hierarkis)
CREATE MATERIALIZED VIEW candles_15s WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '15 seconds', ts) AS bucket, mint,
       first(price_sol, ts) AS open, max(price_sol) AS high, min(price_sol) AS low, last(price_sol, ts) AS close,
       sum(sol_amount) AS volume_sol,
       sum(sol_amount) FILTER (WHERE side = 'buy') AS buy_vol_sol,
       sum(sol_amount) FILTER (WHERE side = 'sell') AS sell_vol_sol,
       count(*) AS n_trades
FROM trades_raw GROUP BY bucket, mint WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1m WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 minute', ts) AS bucket, mint,
       first(price_sol, ts) AS open, max(price_sol) AS high, min(price_sol) AS low, last(price_sol, ts) AS close,
       sum(sol_amount) AS volume_sol,
       sum(sol_amount) FILTER (WHERE side = 'buy') AS buy_vol_sol,
       sum(sol_amount) FILTER (WHERE side = 'sell') AS sell_vol_sol,
       count(*) AS n_trades
FROM trades_raw GROUP BY bucket, mint WITH NO DATA;

CREATE MATERIALIZED VIEW candles_5m WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '5 minutes', bucket) AS bucket, mint,
       first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
       sum(volume_sol) AS volume_sol, sum(buy_vol_sol) AS buy_vol_sol, sum(sell_vol_sol) AS sell_vol_sol,
       sum(n_trades) AS n_trades
FROM candles_1m GROUP BY 1, mint WITH NO DATA;

CREATE MATERIALIZED VIEW candles_15m WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '15 minutes', bucket) AS bucket, mint,
       first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
       sum(volume_sol) AS volume_sol, sum(buy_vol_sol) AS buy_vol_sol, sum(sell_vol_sol) AS sell_vol_sol,
       sum(n_trades) AS n_trades
FROM candles_5m GROUP BY 1, mint WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1h WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 hour', bucket) AS bucket, mint,
       first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
       sum(volume_sol) AS volume_sol, sum(buy_vol_sol) AS buy_vol_sol, sum(sell_vol_sol) AS sell_vol_sol,
       sum(n_trades) AS n_trades
FROM candles_15m GROUP BY 1, mint WITH NO DATA;

CREATE MATERIALIZED VIEW candles_4h WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '4 hours', bucket) AS bucket, mint,
       first(open, bucket) AS open, max(high) AS high, min(low) AS low, last(close, bucket) AS close,
       sum(volume_sol) AS volume_sol, sum(buy_vol_sol) AS buy_vol_sol, sum(sell_vol_sol) AS sell_vol_sol,
       sum(n_trades) AS n_trades
FROM candles_1h GROUP BY 1, mint WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_15s', start_offset => INTERVAL '10 minutes', end_offset => INTERVAL '15 seconds', schedule_interval => INTERVAL '15 seconds');
SELECT add_continuous_aggregate_policy('candles_1m',  start_offset => INTERVAL '30 minutes', end_offset => INTERVAL '1 minute',   schedule_interval => INTERVAL '30 seconds');
SELECT add_continuous_aggregate_policy('candles_5m',  start_offset => INTERVAL '2 hours',    end_offset => INTERVAL '5 minutes',  schedule_interval => INTERVAL '1 minute');
SELECT add_continuous_aggregate_policy('candles_15m', start_offset => INTERVAL '6 hours',    end_offset => INTERVAL '15 minutes', schedule_interval => INTERVAL '5 minutes');
SELECT add_continuous_aggregate_policy('candles_1h',  start_offset => INTERVAL '1 day',      end_offset => INTERVAL '1 hour',     schedule_interval => INTERVAL '15 minutes');
SELECT add_continuous_aggregate_policy('candles_4h',  start_offset => INTERVAL '3 days',     end_offset => INTERVAL '4 hours',    schedule_interval => INTERVAL '1 hour');

-- Statistik pasca-trigger (Trigger Lab) & shadow
CREATE TABLE tracked_paths (
  mint             text NOT NULL,
  source           text NOT NULL,
  t0               timestamptz NOT NULL,
  profile_shadow   text,
  entry_price_ref  double precision,
  ret_1m           double precision,
  ret_5m           double precision,
  ret_15m          double precision,
  ret_60m          double precision,
  max_ret          double precision,
  t_max_sec        integer,
  min_ret          double precision,
  t_min_sec        integer,
  rugged           boolean,
  was_rejected     boolean NOT NULL DEFAULT false,
  reject_rules     text[] NOT NULL DEFAULT '{}',
  completed_at     timestamptz,
  PRIMARY KEY (mint, source, t0)
);
CREATE INDEX tracked_paths_source_idx ON tracked_paths (source, t0 DESC);

-- ===================== trading =====================
CREATE TABLE signals (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  mint         text NOT NULL,
  profile      text NOT NULL,
  score        numeric,
  reasons      jsonb NOT NULL DEFAULT '{}',
  decision_id  bigint
);

CREATE TABLE positions (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mint              text NOT NULL,
  profile           text NOT NULL,
  mode              text NOT NULL CHECK (mode IN ('paper', 'live')),
  status            text NOT NULL CHECK (status IN ('PENDING_ENTRY', 'OPEN', 'PARTIAL_EXIT', 'EXITING', 'CLOSED', 'ENTRY_FAILED')),
  opened_at         timestamptz,
  closed_at         timestamptz,
  entry_price       double precision,
  size_sol          numeric NOT NULL,
  tokens_held       numeric NOT NULL DEFAULT 0,
  realized_pnl_sol  numeric NOT NULL DEFAULT 0,
  pnl_pct           double precision,
  mfe_pct           double precision,
  mae_pct           double precision,
  exit_reason       text,
  config_version    integer REFERENCES config_versions (id),
  signal_id         bigint REFERENCES signals (id)
);
CREATE INDEX positions_status_idx ON positions (status) WHERE status <> 'CLOSED';
CREATE INDEX positions_closed_idx ON positions (mode, profile, closed_at DESC);

CREATE TABLE orders (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id              text NOT NULL UNIQUE,
  position_id            bigint REFERENCES positions (id),
  mode                   text NOT NULL CHECK (mode IN ('paper', 'live')),
  side                   text NOT NULL CHECK (side IN ('buy', 'sell')),
  reason                 text,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  amount_in              numeric NOT NULL,
  quoted_out             numeric,
  slippage_bps           integer,
  priority_fee_lamports  bigint,
  tip_lamports           bigint,
  route                  text,
  status                 text NOT NULL CHECK (status IN ('CREATED', 'SENT', 'CONFIRMED', 'FAILED', 'EXPIRED')),
  signature              text,
  error                  text,
  latency_ms             integer
);
CREATE INDEX orders_position_idx ON orders (position_id);

CREATE TABLE fills (
  order_id          bigint PRIMARY KEY REFERENCES orders (id),
  ts                timestamptz NOT NULL,
  amount_in         numeric NOT NULL,
  amount_out        numeric NOT NULL,
  exec_price        double precision NOT NULL,
  network_fee_sol   numeric NOT NULL DEFAULT 0,
  platform_fee      numeric NOT NULL DEFAULT 0,
  pool_fee_est      numeric NOT NULL DEFAULT 0,
  rent_delta_sol    numeric NOT NULL DEFAULT 0,
  quote_vs_fill_bps integer
);

CREATE TABLE position_marks (
  ts                 timestamptz NOT NULL,
  position_id        bigint NOT NULL,
  price              double precision NOT NULL,
  pnl_pct            double precision NOT NULL,
  exec_value_sol     double precision,
  trailing_stop_pct  double precision
);
SELECT create_hypertable('position_marks', by_range('ts', INTERVAL '1 day'));
CREATE INDEX position_marks_pos_idx ON position_marks (position_id, ts DESC);

CREATE TABLE daily_stats (
  day         date NOT NULL,
  profile     text NOT NULL,
  mode        text NOT NULL,
  trades      integer NOT NULL DEFAULT 0,
  wins        integer NOT NULL DEFAULT 0,
  pnl_sol     numeric NOT NULL DEFAULT 0,
  fees_sol    numeric NOT NULL DEFAULT 0,
  max_dd_pct  double precision,
  PRIMARY KEY (day, profile, mode)
);

-- ===================== kontrol, wallet, LLM, observability =====================
CREATE TABLE control_events (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts       timestamptz NOT NULL DEFAULT now(),
  actor    text NOT NULL,
  action   text NOT NULL,
  payload  jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE watch_wallets (
  address   text PRIMARY KEY,
  label     text,
  source    text,
  active    boolean NOT NULL DEFAULT true,
  score     jsonb NOT NULL DEFAULT '{}',
  added_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blacklist (
  address   text PRIMARY KEY,
  kind      text NOT NULL CHECK (kind IN ('dev', 'funder', 'token', 'cluster')),
  reason    text,
  added_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE llm_jobs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  priority    smallint NOT NULL DEFAULT 5,
  input       jsonb NOT NULL,
  output      jsonb,
  model       text,
  tokens_in   integer,
  tokens_out  integer,
  cost_usd    numeric,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  done_at     timestamptz
);
CREATE INDEX llm_jobs_queue_idx ON llm_jobs (priority, created_at) WHERE status = 'queued';

CREATE TABLE llm_annotations (
  mint   text NOT NULL,
  kind   text NOT NULL,
  data   jsonb NOT NULL,
  model  text,
  ts     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mint, kind)
);

CREATE TABLE system_events (
  ts       timestamptz NOT NULL DEFAULT now(),
  level    text NOT NULL,
  service  text NOT NULL,
  kind     text NOT NULL,
  message  text,
  data     jsonb NOT NULL DEFAULT '{}'
);
SELECT create_hypertable('system_events', by_range('ts', INTERVAL '1 day'));
CREATE INDEX system_events_kind_idx ON system_events (service, kind, ts DESC);

CREATE TABLE api_usage (
  ts          timestamptz NOT NULL DEFAULT now(),
  provider    text NOT NULL,
  endpoint    text NOT NULL,
  status      integer,
  latency_ms  integer
);
SELECT create_hypertable('api_usage', by_range('ts', INTERVAL '1 day'));

-- ===================== kompresi & retensi (disk 40 GB) =====================
ALTER TABLE trades_raw SET (timescaledb.compress, timescaledb.compress_segmentby = 'mint', timescaledb.compress_orderby = 'ts DESC');
ALTER TABLE ticks SET (timescaledb.compress, timescaledb.compress_segmentby = 'mint', timescaledb.compress_orderby = 'ts DESC');
ALTER TABLE position_marks SET (timescaledb.compress, timescaledb.compress_segmentby = 'position_id');
ALTER TABLE token_snapshots SET (timescaledb.compress, timescaledb.compress_segmentby = 'mint');
ALTER TABLE decisions SET (timescaledb.compress, timescaledb.compress_segmentby = 'profile');

SELECT add_compression_policy('trades_raw', INTERVAL '2 days');
SELECT add_compression_policy('ticks', INTERVAL '2 days');
SELECT add_compression_policy('position_marks', INTERVAL '7 days');
SELECT add_compression_policy('token_snapshots', INTERVAL '7 days');
SELECT add_compression_policy('decisions', INTERVAL '14 days');

SELECT add_retention_policy('trades_raw', INTERVAL '14 days');
SELECT add_retention_policy('ticks', INTERVAL '30 days');
SELECT add_retention_policy('system_events', INTERVAL '30 days');
SELECT add_retention_policy('api_usage', INTERVAL '14 days');
SELECT add_retention_policy('candles_15s', INTERVAL '7 days');

-- akses read-only dashboard (tabel yang dibuat setelah ini ikut lewat DEFAULT PRIVILEGES)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO memebot_ro;
