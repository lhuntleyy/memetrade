-- 0002 — referensi harga Trigger Lab = harga pasar pertama yang teramati (bukan harga dev saat create).
ALTER TABLE tracked_paths
  ADD COLUMN trigger_price_sol double precision,  -- harga yang dibawa trigger (mis. virtual reserve saat create), info saja
  ADD COLUMN ref_delay_sec integer,               -- jarak trigger → harga pasar pertama
  ADD COLUMN n_ticks integer NOT NULL DEFAULT 0;
-- data smoke test lama memakai referensi harga create → buang supaya stat tidak bias
DELETE FROM tracked_paths;
