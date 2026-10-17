-- 0009 — pengukuran biaya eksekusi nyata: quote beli → quote jual Jupiter untuk token yang baru dievaluasi
CREATE TABLE cost_probes (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts                timestamptz NOT NULL DEFAULT now(),
  mint              text NOT NULL,
  source            text,
  liquidity_usd     numeric,
  mcap_usd          numeric,
  size_sol          numeric NOT NULL,
  tokens_out        numeric,
  sol_back          numeric,
  buy_impact_pct    double precision,
  sell_impact_pct   double precision,
  platform_fee_bps  integer,
  router            text,
  quote_cost_pct    double precision,   -- (size - sol_back) / size: fee pool + platform + impact dua arah
  network_cost_pct  double precision,   -- biaya jaringan entry+exit (base + priority + tip) / size
  total_cost_pct    double precision,
  error             text
);
CREATE INDEX cost_probes_ts_idx ON cost_probes (ts DESC);
CREATE INDEX cost_probes_mint_idx ON cost_probes (mint, ts DESC);
GRANT SELECT ON cost_probes TO memebot_ro;
