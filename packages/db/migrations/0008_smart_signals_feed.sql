-- 0008 — sumber sinyal konfluensi tambahan: feed smart money / KOL GMGN
ALTER TABLE smart_signals DROP CONSTRAINT smart_signals_source_check;
ALTER TABLE smart_signals ADD CONSTRAINT smart_signals_source_check
  CHECK (source IN ('holder_scan', 'wallet_activity', 'gmgn_feed', 'mixed'));
