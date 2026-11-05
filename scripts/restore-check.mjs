import { DatabaseSync } from "node:sqlite";
import { readFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function verifyRestore(backupPath) {
  const source = resolve(backupPath);
  const manifest = JSON.parse(await readFile(source + ".json", "utf8"));
  const hash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
  if (manifest.sha256 !== hash) throw new Error("Контрольная сумма не совпала");
  const temporary = await mkdtemp(join(tmpdir(), "bytmarket-restore-"));
  const restored = join(temporary, "restored.sqlite");
  try {
    await copyFile(source, restored);
    const db = new DatabaseSync(restored);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const integrity = db.prepare("PRAGMA integrity_check").all();
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
        throw new Error("Нарушена целостность");
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Нарушены внешние ключи");
      for (const [table, expected] of Object.entries(manifest.counts)) {
        const actual = db
          .prepare(`SELECT COUNT(*) AS n FROM "${table.replaceAll('"', '""')}"`)
          .get().n;
        if (actual !== expected)
          throw new Error(`Не совпало число записей: ${table}`);
      }
      db.exec(
        "BEGIN IMMEDIATE; CREATE TABLE __restore_probe(value INTEGER); INSERT INTO __restore_probe VALUES(1); ROLLBACK;",
      );
      return {
        verified: true,
        tables: Object.keys(manifest.counts).length,
        created_at: manifest.created_at,
      };
    } finally {
      db.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2]) {
    console.error("Укажите файл: npm run restore-check -- backups/имя.sqlite");
    process.exitCode = 1;
  } else {
    try {
      console.log(
        "Копия восстановлена в отдельной временной БД и проверена:",
        await verifyRestore(process.argv[2]),
      );
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
  }
}
