import { createApp } from "../server/index.mjs";
import { createBackup } from "./backup.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const dbPath = process.env.DB_PATH || "data/bytmarket.sqlite";
const backupDir = resolve(process.env.BACKUP_DIR || "backups");
const app = createApp({
  dbPath,
  staticDir: resolve("dist"),
  demoMode: process.env.DEMO_MODE === "1",
  secureCookies: process.env.SECURE_COOKIES === "1",
});
let backupRunning = null,
  stopping = false;
async function snapshot() {
  if (backupRunning) return backupRunning;
  backupRunning = (async () => {
    try {
      const copy = await createBackup(dbPath, backupDir);
      await writeFile(
        join(backupDir, "status.json"),
        JSON.stringify({
          ok: true,
          created_at: copy.manifest.created_at,
          file: copy.manifest.file,
        }),
        { mode: 0o600 },
      );
      console.log("Резервная копия проверена:", copy.manifest.file);
    } catch (e) {
      console.error("Ошибка резервного копирования:", e.message);
      await mkdir(backupDir, { recursive: true, mode: 0o700 }).catch(() => {});
      await writeFile(
        join(backupDir, "status.json"),
        JSON.stringify({
          ok: false,
          checked_at: new Date().toISOString(),
          error:
            "Не удалось создать резервную копию. Проверьте журнал сервера и свободное место.",
        }),
        { mode: 0o600 },
      ).catch(() => {});
    }
  })().finally(() => {
    backupRunning = null;
  });
  return backupRunning;
}
await snapshot();
const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 3000);
app.server.listen(port, host, () =>
  console.log(`БытМаркет: http://${host}:${port}`),
);
const timer = setInterval(snapshot, 6 * 60 * 60 * 1000);
timer.unref();
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await app.close();
  if (backupRunning) await backupRunning;
  await snapshot();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
