import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
export function registerMaintenance(add, ctx) {
  add("GET", "/maintenance/status", ({ user }) => {
    ctx.requireRole(user, "owner");
    let backup;
    try {
      backup = JSON.parse(
        readFileSync(
          join(resolve(process.env.BACKUP_DIR || "backups"), "status.json"),
          "utf8",
        ),
      );
    } catch {
      backup = {
        ok: null,
        error:
          "Проверенная автоматическая копия ещё не создана. Запустите сервер через npm start.",
      };
    }
    return {
      backup,
      cash_register: "not_connected",
      one_c: "not_connected",
      storage: "server_sqlite",
      custom_backup_path: Boolean(process.env.BACKUP_DIR),
    };
  });
}
