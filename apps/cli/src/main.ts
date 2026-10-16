import { createDb, migrate } from "@memebot/db";
import { ConfigError, configSchemas, loadConfig } from "@memebot/shared";

const commands: Record<string, { help: string; run: (args: string[]) => Promise<number> }> = {
  migrate: {
    help: "jalankan migrasi SQL yang belum dijalankan",
    async run() {
      const db = createDb(process.env.DATABASE_URL, { max: 1 });
      try {
        const ran = await migrate(db);
        console.log(ran.length ? `selesai: ${ran.join(", ")}` : "skema sudah terbaru");
        return 0;
      } finally {
        await db.close();
      }
    },
  },
  "config:check": {
    help: "validasi semua file config/*.yaml",
    async run() {
      let failed = 0;
      for (const kind of Object.keys(configSchemas) as (keyof typeof configSchemas)[]) {
        try {
          const c = await loadConfig(kind);
          console.log(`✓ ${kind.padEnd(9)} ${c.hash.slice(0, 12)}  ${c.path}`);
        } catch (e) {
          failed++;
          console.error(e instanceof ConfigError ? `✗ ${e.message}` : e);
        }
      }
      return failed ? 1 : 0;
    },
  },
};

const [name, ...args] = process.argv.slice(2);
const cmd = name ? commands[name] : undefined;
if (!cmd) {
  console.log("pemakaian: bun run apps/cli/src/main.ts <perintah>\n");
  for (const [n, c] of Object.entries(commands)) console.log(`  ${n.padEnd(14)} ${c.help}`);
  process.exit(name ? 1 : 0);
}
process.exit(await cmd.run(args));
