-- 0010 — kalibrasi replay dari paper trading (gap exit per alasan, slippage entry, dsb)
CREATE TABLE replay_calibration (
  id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  n_trades  integer NOT NULL,
  params    jsonb NOT NULL,   -- { exitGapPct: { hard_sl: n, ... }, entrySlipPct, ... }
  summary   jsonb NOT NULL,   -- ringkasan perbandingan paper vs replay sebelum/sesudah kalibrasi
  note      text
);
GRANT SELECT ON replay_calibration TO memebot_ro;
