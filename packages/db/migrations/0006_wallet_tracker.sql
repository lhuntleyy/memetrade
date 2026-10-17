-- 0006 — wallet tracker: wallet yang terlihat sebagai top holder / pembeli besar per token
CREATE TABLE wallet_observations (
  wallet          text NOT NULL,
  mint            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('top_holder', 'big_buyer')),
  ts              timestamptz NOT NULL DEFAULT now(),
  symbol          text,
  rank            integer,                 -- peringkat % supply (top_holder)
  buy_tier_usd    numeric,                 -- tier tertinggi yang terlewati (big_buyer), mis. 500 / 1000
  usd_value       numeric,
  amount_pct      double precision,        -- % supply
  buy_volume_usd  numeric,
  sell_volume_usd numeric,
  profit_usd      numeric,
  tags            text[] NOT NULL DEFAULT '{}',
  maker_tags      text[] NOT NULL DEFAULT '{}',
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, mint, kind)
);
CREATE INDEX wallet_obs_wallet_idx ON wallet_observations (wallet, ts DESC);
CREATE INDEX wallet_obs_mint_idx ON wallet_observations (mint);
CREATE INDEX wallet_obs_ts_idx ON wallet_observations (ts DESC);
GRANT SELECT ON wallet_observations TO memebot_ro;
