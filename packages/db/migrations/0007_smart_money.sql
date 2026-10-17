-- 0007 — smart money: skor wallet, kapan wallet mulai pegang token, dan sinyal konfluensi
ALTER TABLE wallet_observations ADD COLUMN holding_since timestamptz;   -- GMGN start_holding_at

ALTER TABLE watch_wallets
  ADD COLUMN score_value numeric,                  -- 0..100 (null = sampel kurang)
  ADD COLUMN auto boolean NOT NULL DEFAULT false,  -- true = dimasukkan otomatis oleh scorer
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE smart_signals (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  mint       text NOT NULL,
  symbol     text,
  source     text NOT NULL CHECK (source IN ('holder_scan', 'wallet_activity')),
  wallets    text[] NOT NULL,
  n_wallets  integer NOT NULL,
  avg_score  numeric
);
CREATE INDEX smart_signals_ts_idx ON smart_signals (ts DESC);
CREATE INDEX smart_signals_mint_idx ON smart_signals (mint, ts DESC);
GRANT SELECT ON smart_signals TO memebot_ro;
GRANT SELECT ON watch_wallets TO memebot_ro;
