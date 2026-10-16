import { createLogger, loadConfig } from "@memebot/shared";

// Fase 4 (P4-04): consumer llm_jobs (FOR UPDATE SKIP LOCKED) → Anthropic → llm_annotations.
const log = createLogger("llm-worker");
const cfg = await loadConfig("llm");
if (!cfg.data.enabled) {
  log.info("llm.enabled = false — worker tidak melakukan apa-apa");
  process.exit(0);
}
log.error("LLM worker belum diimplementasi (Fase 4)");
process.exit(1);
