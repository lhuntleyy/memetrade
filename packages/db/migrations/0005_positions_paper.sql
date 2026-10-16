-- 0005 — kolom tambahan posisi untuk paper trading & restore setelah restart
ALTER TABLE positions
  ADD COLUMN symbol          text,
  ADD COLUMN tokens_initial  numeric,
  ADD COLUMN cost_sol        numeric,          -- total SOL keluar saat entry (nominal + fee jaringan + rent ATA)
  ADD COLUMN proceeds_sol    numeric NOT NULL DEFAULT 0,  -- total SOL masuk bersih dari semua penjualan
  ADD COLUMN fees_sol        numeric NOT NULL DEFAULT 0,  -- biaya jaringan entry + exit
  ADD COLUMN last_price      double precision,
  ADD COLUMN exit_state      jsonb,            -- state exit engine (peak, ladder, dsb) untuk restore
  ADD COLUMN trigger_source  text,
  ADD COLUMN risk_reasons    text[];
CREATE INDEX positions_mint_idx ON positions (mint, opened_at DESC);
