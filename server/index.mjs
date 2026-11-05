import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { createDb } from "./db.mjs";
import { installCore, registerCore, publicUser, fail } from "./core.mjs";
import { initExtensions, registerExtensions } from "./extensions.mjs";
import { registerCompletion } from "./completion.mjs";
import { registerMaintenance } from "./maintenance.mjs";
const digest = (s) => createHash("sha256").update(s).digest("hex");
function sendBody(req, res, value) {
  let body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  res.setHeader("Vary", "Accept-Encoding");
  const acceptsGzip = String(req.headers["accept-encoding"] || "")
    .split(",")
    .some((entry) =>
      /^gzip(?:\s*;\s*q=(?:1(?:\.0*)?|0?\.[0-9]*[1-9][0-9]*))?$/i.test(
        entry.trim(),
      ),
    );
  if (body.length > 1024 && acceptsGzip) {
    body = gzipSync(body);
    res.setHeader("Content-Encoding", "gzip");
  }
  res.setHeader("Content-Length", body.length);
  res.end(req.method === "HEAD" ? undefined : body);
}
const safeEqual = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createApp({
  dbPath = process.env.DB_PATH || "data/bytmarket.sqlite",
  staticDir = resolve("dist"),
  demoMode = false,
  secureCookies = false,
} = {}) {
  const db = createDb(dbPath);
  initExtensions(db);
  const ctx = installCore({ db });
  ctx.secureCookies = secureCookies;
  if (demoMode) {
    const marked = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='demo_access'",
      )
      .get();
    if (
      !marked ||
      db.prepare("SELECT count(*) n FROM demo_access").get().n !== 8
    ) {
      db.close();
      throw new Error(
        "Режим без паролей разрешён только для подготовленной демонстрационной базы",
      );
    }
    ctx.demoMode = true;
  }
  const routes = [];
  const add = (method, path, handler, options = {}) => {
    const names = [];
    const pattern = new RegExp(
      "^/api/v1" +
        path.replace(/:([A-Za-z_]+)/g, (_, name) => {
          names.push(name);
          return "([^/]+)";
        }) +
        "/?$",
    );
    routes.push({ method, pattern, names, handler, ...options });
  };
  registerCompletion(add, ctx);
  registerCore(add, ctx);
  registerExtensions(add, ctx);
  registerMaintenance(add, ctx);
  ctx.dispatch = (method, path, args) => {
    const route = routes.find(
      (r) => r.method === method && r.pattern.test("/api/v1" + path),
    );
    if (!route || route.public) fail(400, "Операция импорта недоступна");
    return route.handler({ ...args, params: {}, query: {} });
  };

  const digestTimer = setInterval(() => {
    try {
      ctx.refreshDigest?.();
    } catch (e) {
      console.error("Owner digest failed:", e.message);
    }
  }, 60000);
  digestTimer.unref();
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method))
          fail(405, "Метод не разрешён");
        const root = resolve(staticDir);
        let file = resolve(root, "." + decodeURIComponent(url.pathname));
        if (file !== root && !file.startsWith(root + sep))
          fail(403, "Недопустимый путь");
        try {
          if (!statSync(file).isFile()) file = resolve(root, "index.html");
        } catch {
          file = resolve(root, "index.html");
        }
        let real;
        try {
          real = realpathSync(file);
          if (!real.startsWith(realpathSync(root) + sep))
            fail(403, "Недопустимый файл");
        } catch (e) {
          if (e.status) throw e;
          fail(503, "Интерфейс ещё не собран. Выполните npm run build.");
        }
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".woff2": "font/woff2",
          ".ico": "image/x-icon",
          ".json": "application/json",
        };
        res.setHeader(
          "Content-Type",
          types[extname(real)] || "application/octet-stream",
        );
        res.setHeader(
          "Cache-Control",
          extname(real) === ".html" ? "no-cache" : "public, max-age=3600",
        );
        res.statusCode = 200;
        sendBody(req, res, readFileSync(real));
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      const route = routes.find(
        (r) => r.method === req.method && r.pattern.test(url.pathname),
      );
      if (!route) fail(404, "API маршрут не найден");
      const mutation = !["GET", "HEAD"].includes(req.method);
      if (mutation) {
        const origin = req.headers.origin;
        if (origin) {
          let parsed;
          try {
            parsed = new URL(origin);
          } catch {
            fail(403, "Недопустимый Origin");
          }
          if (
            parsed.host !== req.headers.host ||
            !["http:", "https:"].includes(parsed.protocol)
          )
            fail(403, "Запрос из другого источника запрещён");
        }
        if (req.headers["sec-fetch-site"] === "cross-site")
          fail(403, "Межсайтовый запрос запрещён");
      }
      let body = {};
      if (mutation) {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) fail(413, "Запрос слишком большой");
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        if (raw) {
          if (
            !String(req.headers["content-type"] || "").startsWith(
              "application/json",
            )
          )
            fail(415, "Ожидается application/json");
          try {
            body = JSON.parse(raw);
          } catch {
            fail(400, "Некорректный JSON");
          }
          if (!body || Array.isArray(body) || typeof body !== "object")
            fail(400, "Ожидается JSON объект");
        }
      }
      let user = null,
        session = null;
      const token = String(req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("bytmarket_session="))
        ?.slice("bytmarket_session=".length);
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        session = ctx.get(
          "SELECT * FROM sessions WHERE id=? AND expires_at>?",
          digest(token),
          ctx.now(),
        );
        if (session) {
          const row = ctx.get(
            "SELECT * FROM users WHERE id=? AND active=1",
            session.user_id,
          );
          user = publicUser(row);
          if (user)
            user.permissions = JSON.parse(
              ctx.get(
                "SELECT permissions FROM user_permissions WHERE user_id=?",
                user.id,
              )?.permissions || "{}",
            );
          if (!user) session = null;
        }
      }
      if (!route.public && !user) fail(401, "Войдите в систему");
      if (
        !route.public &&
        mutation &&
        !safeEqual(req.headers["x-csrf-token"], session.csrf)
      )
        fail(403, "CSRF токен недействителен");
      if (user && !user.roles.includes("owner")) {
        const rights = user.permissions || {},
          path = url.pathname.replace("/api/v1", "");
        if (rights.view_cost === false && path.startsWith("/reports/"))
          fail(403, "Просмотр финансовых показателей отключён владельцем");
        if (
          mutation &&
          rights.change_prices === false &&
          (/^\/products(?:\/|$)/.test(path) ||
            path.startsWith("/client-prices") ||
            (path.startsWith("/imports/") && body.kind === "prices"))
        )
          fail(403, "Изменение каталога и цен отключено");
        if (
          mutation &&
          rights.returns === false &&
          (/\/return$/.test(path) ||
            path === "/refunds" ||
            path === "/supplier-returns")
        )
          fail(403, "Возвраты отключены владельцем");
        if (
          mutation &&
          rights.writeoff === false &&
          (path === "/stock/adjust" || /^\/stocktakes\/[^/]+\/post$/.test(path))
        )
          fail(403, "Списания и проведение пересчёта отключены");
      }
      const matches = route.pattern.exec(url.pathname);
      const params = Object.fromEntries(
        route.names.map((n, i) => [n, decodeURIComponent(matches[i + 1])]),
      );
      const args = {
        user,
        session,
        body,
        params,
        query: Object.fromEntries(url.searchParams),
        req,
        res,
      };
      let result;
      if (mutation && !route.public) {
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || key.length < 8 || key.length > 200)
          fail(400, "Укажите Idempotency-Key от 8 до 200 символов");
        const hash = digest(
          req.method +
            " " +
            url.pathname +
            " " +
            JSON.stringify(body) +
            " " +
            JSON.stringify([
              user.roles,
              user.entity_ids,
              user.warehouse_ids,
              user.permissions,
            ]),
        );
        result = ctx.tx(() => {
          const prior = ctx.get(
            "SELECT * FROM idempotency WHERE user_id=? AND key=?",
            user.id,
            key,
          );
          if (prior) {
            if (prior.request_hash !== hash)
              fail(409, "Этот ключ уже использован для другой команды");
            return JSON.parse(prior.result);
          }
          const value = route.handler(args) ?? { ok: true };
          if (value?.then) throw new Error("Async mutation is not supported");
          ctx.run(
            "INSERT INTO idempotency VALUES(?,?,?,?,?)",
            user.id,
            key,
            hash,
            JSON.stringify(value),
            ctx.now(),
          );
          return value;
        });
      } else result = await route.handler(args);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      sendBody(req, res, JSON.stringify(result ?? { ok: true }));
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      let status = error.status || 500;
      let message = error.message;
      if (!error.status && /UNIQUE constraint failed/.test(message)) {
        status = 409;
        message = "Запись с таким уникальным значением уже существует";
      } else if (
        !error.status &&
        /FOREIGN KEY constraint failed|CHECK constraint failed|NOT NULL constraint failed/.test(
          message,
        )
      ) {
        status = 400;
        message = "Данные нарушают ограничения учёта";
      } else if (!error.status) {
        console.error(error);
        message = "Внутренняя ошибка сервера";
      }
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({ error: message, code: error.code || undefined }),
      );
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const close = () =>
    new Promise((resolveClose, reject) => {
      const finish = () => {
        try {
          db.close();
          resolveClose();
        } catch (e) {
          reject(e);
        }
      };
      if (server.listening) {
        server.close((e) => (e ? reject(e) : finish()));
        server.closeIdleConnections();
      } else finish();
    });
  const closeWithJobs = () => {
    clearInterval(digestTimer);
    return close();
  };
  return { server, db, ctx, close: closeWithJobs };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const app = createApp();
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, host, () =>
    console.log(`БытМаркет: http://${host}:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => app.close().then(() => process.exit(0)));
}
