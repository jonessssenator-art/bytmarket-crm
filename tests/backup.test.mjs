import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup } from "../scripts/backup.mjs";
import { verifyRestore } from "../scripts/restore-check.mjs";
test("online WAL backup includes committed data and rejects altered copies", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bytmarket-backup-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "source.sqlite"),
    db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE sample(id INTEGER PRIMARY KEY,note TEXT);",
  );
  db.prepare("INSERT INTO sample(note) VALUES(?)").run("Проверка живой базы");
  const copy = await createBackup(path, join(dir, "copies"));
  const restored = new DatabaseSync(copy.path, { readOnly: true });
  assert.equal(
    restored.prepare("SELECT note FROM sample").get().note,
    "Проверка живой базы",
  );
  restored.close();
  assert.equal((await verifyRestore(copy.path)).verified, true);
  await appendFile(copy.path, "changed");
  await assert.rejects(verifyRestore(copy.path), /Контрольная сумма/);
  await assert.rejects(
    createBackup(join(dir, "missing.sqlite"), join(dir, "copies")),
    /ENOENT/,
  );
});
