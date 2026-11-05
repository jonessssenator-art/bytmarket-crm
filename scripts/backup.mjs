import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdir,
  chmod,
  rename,
  readFile,
  writeFile,
  stat,
  unlink,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function createBackup(dbPath, directory) {
  const source = resolve(dbPath);
  await stat(source); // Never silently create an empty source database.
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `bytmarket-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.sqlite`;
  const target = join(resolve(directory), name);
  const staging = target + ".partial";
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, staging);
    await chmod(staging, 0o600);
    const snapshot = new DatabaseSync(staging, { readOnly: true });
    let counts;
    try {
      const integrity = snapshot.prepare("PRAGMA integrity_check").all();
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
        throw new Error("Проверка резервной копии не пройдена");
      if (snapshot.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Нарушены связи в резервной копии");
      counts = {};
      for (const row of snapshot
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all()) {
        const name = row.name.replaceAll('"', '""');
        counts[row.name] = snapshot
          .prepare(`SELECT COUNT(*) AS n FROM "${name}"`)
          .get().n;
      }
    } finally {
      snapshot.close();
    }
    await rename(staging, target);
    const digest = createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
    const manifest = {
      format: 1,
      created_at: new Date().toISOString(),
      file: name,
      sha256: digest,
      counts,
    };
    await writeFile(target + ".json", JSON.stringify(manifest, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    return { path: target, manifest };
  } catch (error) {
    await unlink(staging).catch(() => {});
    throw error;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await createBackup(
      process.env.DB_PATH || "data/bytmarket.sqlite",
      process.env.BACKUP_DIR || "backups",
    );
    console.log("Резервная копия создана и проверена:", result.path);
  } catch (e) {
    console.error("Копирование не выполнено:", e.message);
    process.exitCode = 1;
  }
}
