import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { ROLES, hashPassword } from "../server/core.mjs";

// Explicitly opt in on an isolated database; never run automatically on the live database.
export function enableDemo(path) {
  if (!path || resolve(path) === resolve("data/bytmarket.sqlite"))
    throw Error("Укажите отдельную тестовую базу, не основную CRM");
  if (!existsSync(path)) throw Error("Тестовая база не найдена");
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS demo_access(role TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));",
    );
    const entities = JSON.stringify(
      db
        .prepare("SELECT id FROM entities")
        .all()
        .map((x) => x.id),
    );
    const warehouses = JSON.stringify(
      db
        .prepare("SELECT id FROM warehouses")
        .all()
        .map((x) => x.id),
    );
    for (const role of ROLES) {
      if (db.prepare("SELECT role FROM demo_access WHERE role=?").get(role))
        continue;
      let row = db
        .prepare("SELECT id FROM users WHERE email=? AND active=1")
        .get(
          role === "owner"
            ? "demo@bytmarket.local"
            : `test.${role}@bytmarket.local`,
        );
      if (!row)
        row = db
          .prepare(
            "SELECT id FROM users WHERE active=1 AND email LIKE 'test.%' AND roles=? ORDER BY created_at LIMIT 1",
          )
          .get(JSON.stringify([role]));
      if (!row) {
        row = { id: randomUUID() };
        db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)").run(
          row.id,
          `Демо: ${role}`,
          `demo.${role}@bytmarket.invalid`,
          hashPassword(randomBytes(32).toString("hex")),
          JSON.stringify([role]),
          entities,
          warehouses,
          1,
          new Date().toISOString(),
        );
      }
      db.prepare("INSERT INTO demo_access VALUES(?,?)").run(role, row.id);
    }
    db.exec("DELETE FROM sessions; COMMIT;");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv.includes("--isolated-demo"))
    throw Error("Подтвердите отдельную тестовую базу флагом --isolated-demo");
  const index = process.argv.indexOf("--db");
  if (
    index < 0 ||
    !process.argv[index + 1] ||
    process.argv[index + 1].startsWith("--")
  )
    throw Error("Укажите --db /путь/к/тестовой.sqlite");
  enableDemo(process.argv[index + 1]);
  console.log(
    "Восемь тестовых ролей подготовлены. Для запуска укажите DEMO_MODE=1.",
  );
}
