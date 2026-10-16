-- 0003 — hubungkan keputusan dengan trigger asalnya (untuk shadow / filter effectiveness)
ALTER TABLE decisions
  ADD COLUMN trigger_source text,          -- "sumber.jenis", sama dengan tracked_paths.source
  ADD COLUMN trigger_ts timestamptz;       -- = token_triggers.ts = tracked_paths.t0
CREATE INDEX decisions_trigger_idx ON decisions (mint, trigger_source, trigger_ts);
