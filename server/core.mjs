import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";

export const ROLES = [
  "owner",
  "seller",
  "manager",
  "rep",
  "accountant",
  "warehouse",
  "dispatcher",
  "courier",
];
const json = (x) => JSON.stringify(x);
const parse = (x, fallback = []) => {
  try {
    return JSON.parse(x);
  } catch {
    return fallback;
  }
};
export function fail(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  throw e;
}
function text(v, label, required = false, max = 4000) {
  if (v == null && !required) return "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    fail(400, `Некорректное поле: ${label}`);
  return v.trim();
}
function int(v, label, min = 0) {
  if (!Number.isSafeInteger(v) || v < min || Math.abs(v) > 1_000_000_000_000)
    fail(400, `Некорректное число: ${label}`);
  return v;
}
function date(v, label) {
  if (!v) return null;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(new Date(v).getTime()) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail(400, `Некорректная дата: ${label}`);
  return v;
}
const has = (u, ...roles) =>
  u?.roles?.includes("owner") || roles.some((r) => u?.roles?.includes(r));
const finance = (u) =>
  has(u, "owner") || (u?.permissions?.view_cost ?? has(u, "accountant"));
function moneyMul(a, b) {
  const v = a * b;
  if (!Number.isSafeInteger(v) || Math.abs(v) > 1_000_000_000_000)
    fail(400, "Сумма слишком велика");
  return v;
}
export function hashPassword(password) {
  text(password, "пароль", true, 200);
  if (password.length < 12)
    fail(400, "Пароль должен содержать минимум 12 символов");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 200) return false;
  const [salt, key] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...u } = row;
  return {
    ...u,
    roles: parse(u.roles),
    entity_ids: parse(u.entity_ids),
    warehouse_ids: parse(u.warehouse_ids),
    active: !!u.active,
  };
}

export function installCore(ctx) {
  const { db } = ctx;
  const get = (sql, ...args) => db.prepare(sql).get(...args),
    all = (sql, ...args) => db.prepare(sql).all(...args),
    run = (sql, ...args) => db.prepare(sql).run(...args);
  Object.assign(ctx, {
    get,
    all,
    run,
    id: randomUUID,
    now: () => new Date().toISOString(),
    error: fail,
    has,
    finance,
  });
  let depth = 0;
  ctx.tx = (fn) => {
    if (depth) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    try {
      const result = fn();
      if (result?.then)
        throw new Error("Transaction callback must be synchronous");
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
    }
  };
  ctx.requireRole = (u, ...roles) => {
    if (!has(u, ...roles)) fail(403, "Недостаточно прав");
  };
  ctx.scope = (u, e, w) => {
    if (!u) fail(401, "Войдите в систему");
    if (e && !get("SELECT id FROM entities WHERE id=?", e))
      fail(404, "Организация не найдена");
    if (w && !get("SELECT id FROM warehouses WHERE id=?", w))
      fail(404, "Склад не найден");
    if (
      !has(u, "owner") &&
      ((e && !u.entity_ids.includes(e)) || (w && !u.warehouse_ids.includes(w)))
    )
      fail(403, "Нет доступа к организации или складу");
  };
  ctx.audit = (u, action, type, id, payload = {}) =>
    run(
      "INSERT INTO audit VALUES (?,?,?,?,?,?,?)",
      randomUUID(),
      u.id,
      action,
      type,
      String(id),
      json(payload),
      ctx.now(),
    );
  ctx.setting = (key, fallback = null) => {
    const v = get("SELECT value FROM settings WHERE key=?", key);
    return v ? parse(v.value, fallback) : fallback;
  };
  ctx.balance = (e, w, p) => {
    const v = get(
      "SELECT * FROM inventory WHERE entity_id=? AND warehouse_id=? AND product_id=?",
      e,
      w,
      p,
    ) || {
      entity_id: e,
      warehouse_id: w,
      product_id: p,
      on_hand: 0,
      reserved: 0,
      quarantine: 0,
      cost_cents: null,
    };
    const b = get(
      "SELECT COALESCE(SUM(qty-reserved),0) available FROM stock_batches WHERE entity_id=? AND warehouse_id=? AND product_id=? AND (expires_at IS NULL OR expires_at>=?)",
      e,
      w,
      p,
      ctx.now().slice(0, 10),
    );
    return { ...v, available: b.available };
  };
  ctx.syncInventory = (e, w, p) => {
    const batches = all(
      "SELECT * FROM stock_batches WHERE entity_id=? AND warehouse_id=? AND product_id=?",
      e,
      w,
      p,
    );
    let qty = 0,
      res = 0,
      q = 0,
      cost = 0,
      known = true;
    for (const b of batches) {
      qty += b.qty;
      res += b.reserved;
      q += b.quarantine;
      if (b.qty && b.cost_cents == null) known = false;
      cost += b.qty * (b.cost_cents || 0);
    }
    run(
      "INSERT INTO inventory(entity_id,warehouse_id,product_id,on_hand,reserved,quarantine,cost_cents) VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_id,warehouse_id,product_id) DO UPDATE SET on_hand=excluded.on_hand,reserved=excluded.reserved,quarantine=excluded.quarantine,cost_cents=excluded.cost_cents",
      e,
      w,
      p,
      qty,
      res,
      q,
      qty && known ? Math.round(cost / qty) : null,
    );
    ctx.refreshAlerts(e, w, p);
  };
  ctx.refreshAlerts = (e, w, p) => {
    const b = ctx.balance(e, w, p);
    const product = get("SELECT active,min_stock FROM products WHERE id=?", p);
    if (!product) return;
    const threshold = product.min_stock;
    const alert = get(
      "SELECT id FROM alerts WHERE entity_id=? AND warehouse_id=? AND product_id=? AND status='open'",
      e,
      w,
      p,
    );
    if (product.active && b.available < threshold) {
      if (alert)
        run(
          "UPDATE alerts SET available=?,threshold=? WHERE id=?",
          b.available,
          threshold,
          alert.id,
        );
      else
        run(
          "INSERT INTO alerts(id,entity_id,warehouse_id,product_id,available,threshold,status,created_at) VALUES(?,?,?,?,?,?,'open',?)",
          randomUUID(),
          e,
          w,
          p,
          b.available,
          threshold,
          ctx.now(),
        );
    } else if (alert)
      run(
        "UPDATE alerts SET status='resolved',available=?,resolved_at=? WHERE id=?",
        b.available,
        ctx.now(),
        alert.id,
      );
  };
  ctx.movement = (u, b, qty, kind, reason, orderId = null) => {
    const id = randomUUID();
    run(
      "INSERT INTO stock_movements(id,entity_id,warehouse_id,product_id,qty,kind,reason,order_id,actor_id,created_at,cost_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id,
      b.entity_id,
      b.warehouse_id,
      b.product_id,
      qty,
      kind,
      reason,
      orderId,
      u.id,
      ctx.now(),
      b.cost_cents ?? null,
    );
    return id;
  };
  ctx.stockReceive = (u, b) =>
    ctx.tx(() => {
      ctx.requireRole(u, "warehouse", "accountant");
      ctx.scope(u, b.entity_id, b.warehouse_id);
      const p = get("SELECT * FROM products WHERE id=?", b.product_id);
      if (!p) fail(404, "Товар не найден");
      const qty = int(b.qty, "количество", 1),
        cost = b.cost_cents == null ? null : int(b.cost_cents, "себестоимость");
      const expiry = date(b.expires_at, "годность");
      if (p.expiry_required && !expiry) fail(400, "Укажите срок годности");
      const reason = text(b.reason, "основание", true);
      if (
        b.supplier_id &&
        !get(
          "SELECT id FROM clients WHERE id=? AND kind='supplier'",
          b.supplier_id,
        )
      )
        fail(400, "Поставщик не найден");
      const quarantine =
        !!p.marked ||
        (expiry && expiry < ctx.now().slice(0, 10)) ||
        !!b.quarantine;
      const id = randomUUID();
      run(
        "INSERT INTO stock_batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        b.entity_id,
        b.warehouse_id,
        b.product_id,
        text(b.batch_number, "партия"),
        expiry,
        b.supplier_id || null,
        quarantine ? 0 : qty,
        0,
        quarantine ? qty : 0,
        cost,
        ctx.now(),
      );
      const mid = ctx.movement(
        u,
        { ...b, cost_cents: cost },
        qty,
        quarantine ? "receive_quarantine" : "receive",
        reason,
      );
      ctx.syncInventory(b.entity_id, b.warehouse_id, b.product_id);
      ctx.audit(u, "receive", "stock", mid, { qty, quarantine, batch_id: id });
      return {
        ...ctx.balance(b.entity_id, b.warehouse_id, b.product_id),
        id: mid,
        batch_id: id,
        verification: p.marked ? "not_configured" : null,
      };
    });
  ctx.canClient = (u, c) =>
    has(u, "owner", "accountant") ||
    (u.permissions?.view_other_clients && has(u, "seller", "manager", "rep")) ||
    (has(u, "seller", "manager", "rep") && c.assigned_to === u.id);
  ctx.canOrder = (u, o) => {
    ctx.scope(u, o.entity_id, o.warehouse_id);
    if (
      has(u, "courier") &&
      get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='deliveries'",
      ) &&
      get(
        "SELECT id FROM deliveries WHERE order_id=? AND courier_id=?",
        o.id,
        u.id,
      )
    )
      return true;
    if (has(u, "owner", "accountant", "warehouse", "dispatcher")) return true;
    if (u.permissions?.view_other_clients && has(u, "seller", "manager", "rep"))
      return true;
    if (has(u, "seller", "manager", "rep") && o.created_by === u.id)
      return true;
    if (has(u, "manager", "rep") && o.client_id) {
      const c = get("SELECT assigned_to FROM clients WHERE id=?", o.client_id);
      if (c?.assigned_to === u.id) return true;
    }
    fail(403, "Нет доступа к заказу");
  };
  ctx.orderView = (u, id) => {
    const o = get(
      "SELECT o.*,c.name client_name,e.name entity_name,w.name warehouse_name FROM orders o LEFT JOIN clients c ON c.id=o.client_id JOIN entities e ON e.id=o.entity_id JOIN warehouses w ON w.id=o.warehouse_id WHERE o.id=?",
      id,
    );
    if (!o) fail(404, "Заказ не найден");
    ctx.canOrder(u, o);
    const lines = all(
      "SELECT l.*,q.quantity,q.unit,q.discount_percent,q.promotion_id,q.base_price_cents FROM order_lines l LEFT JOIN line_quotes q ON q.line_id=l.id WHERE l.order_id=?",
      id,
    ).map((l) => {
      if (!finance(u)) {
        delete l.cost_cents;
      }
      return l;
    });
    if (
      has(u, "warehouse") &&
      !has(u, "owner", "accountant", "seller", "manager", "rep")
    ) {
      delete o.total_cents;
      delete o.paid_cents;
      delete o.refunded_cents;
      delete o.returned_cents;
      delete o.shipped_cents;
      delete o.client_name;
      for (const l of lines) {
        delete l.unit_price_cents;
        delete l.line_total_cents;
        delete l.base_price_cents;
      }
    }
    return { ...o, lines, fiscal_status: "not_connected" };
  };
  ctx.quote = (u, b) => {
    ctx.requireRole(u, "seller", "manager", "rep");
    ctx.scope(u, b.entity_id, b.warehouse_id);
    if (!["retail", "wholesale"].includes(b.channel))
      fail(400, "Выберите розницу или опт");
    if (!["pickup", "delivery"].includes(b.fulfillment))
      fail(400, "Выберите получение");
    if (b.client_id) {
      const c = get("SELECT * FROM clients WHERE id=?", b.client_id);
      if (!c || !ctx.canClient(u, c)) fail(403, "Клиент недоступен");
    } else if (b.channel === "wholesale")
      fail(400, "Укажите клиента оптового заказа");
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 500)
      fail(400, "Добавьте от 1 до 500 строк");
    const seen = new Set();
    let total = 0;
    const lines = b.lines.map((l) => {
      if (seen.has(l.product_id))
        fail(400, "Объедините одинаковый товар в одну строку");
      seen.add(l.product_id);
      const p = get("SELECT * FROM products WHERE id=?", l.product_id);
      if (!p || !p.active) fail(400, "Товар недоступен");
      if (!["piece", "pack", "box"].includes(l.unit || "piece"))
        fail(400, "Неизвестная единица");
      const quantity = int(l.quantity, "количество", 1),
        factor =
          l.unit === "box"
            ? p.pack_size
            : l.unit === "pack"
              ? int(
                  parse(p.attributes, {}).inner_pack_size ?? 1,
                  "штук в упаковке",
                  1,
                )
              : 1,
        qty = moneyMul(quantity, factor);
      let discount = l.discount_percent ?? 0;
      int(discount, "скидка");
      if (
        discount &&
        u.permissions?.manual_discount === false &&
        !has(u, "owner")
      )
        fail(403, "Ручные скидки отключены владельцем");
      if (discount > 100) fail(400, "Скидка превышает 100%");
      if (discount && !has(u, "owner") && !ctx.checkPricePolicy)
        fail(403, "Ручная скидка требует владельца");
      let promotion = null;
      const promos = get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='promotions'",
      )
        ? all(
            "SELECT * FROM promotions WHERE starts_at<=? AND ends_at>=?",
            ctx.now(),
            ctx.now(),
          )
        : [];
      for (const promo of promos) {
        if (
          parse(promo.product_ids).includes(p.id) &&
          Number(promo.discount_percent) > discount
        ) {
          discount = Number(promo.discount_percent);
          promotion = promo.id;
        }
      }
      const personal = b.client_id
        ? get(
            "SELECT price_cents FROM client_prices WHERE entity_id=? AND client_id=? AND product_id=?",
            b.entity_id,
            b.client_id,
            p.id,
          )
        : null;
      const base =
        personal?.price_cents ??
        (b.channel === "wholesale" ? p.wholesale_cents : p.retail_cents);
      const price = Math.round((base * (100 - discount)) / 100);
      const amount = moneyMul(qty, price);
      total += amount;
      if (!Number.isSafeInteger(total) || total > 1e12)
        fail(400, "Сумма слишком велика");
      return {
        id: randomUUID(),
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        qty,
        unit_factor: factor,
        unit_price_cents: price,
        line_total_cents: amount,
        quantity,
        unit: l.unit || "piece",
        discount_percent: discount,
        promotion_id: promotion,
        base_price_cents: base,
      };
    });
    return { lines, total };
  };
  ctx.saveLines = (orderId, lines) => {
    run(
      "DELETE FROM line_quotes WHERE line_id IN (SELECT id FROM order_lines WHERE order_id=?)",
      orderId,
    );
    run("DELETE FROM order_lines WHERE order_id=?", orderId);
    for (const l of lines) {
      run(
        "INSERT INTO order_lines(id,order_id,product_id,name,sku,qty,unit_factor,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?,?)",
        l.id,
        orderId,
        l.product_id,
        l.name,
        l.sku,
        l.qty,
        l.unit_factor,
        l.unit_price_cents,
        l.line_total_cents,
      );
      run(
        "INSERT INTO line_quotes VALUES(?,?,?,?,?,?)",
        l.id,
        l.quantity,
        l.unit,
        l.discount_percent,
        l.promotion_id,
        l.base_price_cents,
      );
    }
  };
  return ctx;
}

export function registerCore(add, ctx) {
  const { db, get, all, run } = ctx;
  const userFields = (b, existing = {}) => {
    const name = text(b.name ?? existing.name, "имя", true, 200);
    const email = text(
      b.email ?? existing.email,
      "email",
      true,
      254,
    ).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "Некорректный email");
    const roles = b.roles ?? parse(existing.roles);
    if (
      !Array.isArray(roles) ||
      !roles.length ||
      roles.some((r) => !ROLES.includes(r))
    )
      fail(400, "Некорректные роли");
    const es = b.entity_ids ?? parse(existing.entity_ids),
      ws = b.warehouse_ids ?? parse(existing.warehouse_ids);
    if (!Array.isArray(es) || !Array.isArray(ws))
      fail(400, "Некорректные области доступа");
    for (const e of es)
      if (!get("SELECT id FROM entities WHERE id=?", e))
        fail(400, "Организация не найдена");
    for (const w of ws)
      if (!get("SELECT id FROM warehouses WHERE id=?", w))
        fail(400, "Склад не найден");
    return { name, email, roles, es, ws };
  };
  const setSession = (req, res, user) => {
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    run(
      "INSERT INTO sessions VALUES(?,?,?,?,?)",
      createHash("sha256").update(token).digest("hex"),
      user.id,
      csrf,
      new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      ctx.now(),
    );
    res.setHeader(
      "Set-Cookie",
      `bytmarket_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${req.socket.encrypted ? "; Secure" : ""}`,
    );
    return { user: publicUser(user), csrf };
  };
  add(
    "GET",
    "/auth/status",
    () => ({ needs_setup: !get("SELECT id FROM users LIMIT 1") }),
    { public: true },
  );
  add(
    "POST",
    "/auth/setup",
    ({ body, req, res }) =>
      ctx.tx(() => {
        if (get("SELECT id FROM users LIMIT 1"))
          fail(409, "Первичная настройка уже выполнена");
        if (
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          ) ||
          !["localhost", "127.0.0.1", "[::1]"].includes(
            new URL("http://" + req.headers.host).hostname,
          )
        )
          fail(403, "Первичная настройка доступна только локально");
        const f = userFields({
          ...body,
          roles: ["owner"],
          entity_ids: [],
          warehouse_ids: [],
        });
        const id = randomUUID(),
          now = ctx.now();
        run(
          "INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)",
          id,
          f.name,
          f.email,
          hashPassword(body.password),
          json(["owner"]),
          "[]",
          "[]",
          1,
          now,
        );
        const llc = randomUUID(),
          ip = randomUUID(),
          w = randomUUID();
        run("INSERT INTO entities VALUES(?,?,?,?)", llc, "ООО", "ooo", "{}");
        run("INSERT INTO entities VALUES(?,?,?,?)", ip, "ИП", "ip", "{}");
        run("INSERT INTO warehouses VALUES(?,?)", w, "Склад при магазине");
        for (const [key, value] of Object.entries({
          wholesale_min_qty: null,
          low_stock_threshold: 50,
          wholesale_entity_id: llc,
          retail_entity_id: ip,
          allow_credit: true,
          legal_transfer_ready: false,
        }))
          run("INSERT INTO settings VALUES(?,?)", key, json(value));
        const u = get("SELECT * FROM users WHERE id=?", id);
        ctx.audit({ id }, "setup", "user", id);
        return setSession(req, res, u);
      }),
    { public: true },
  );
  const loginAttempts = new Map();
  add(
    "POST",
    "/auth/login",
    ({ body, req, res }) => {
      const key =
        (req.socket.remoteAddress || "") +
        ":" +
        String(body.email).toLowerCase();
      const count = loginAttempts.get(key);
      if (count && count.until > Date.now() && count.n >= 10)
        fail(429, "Слишком много попыток, повторите через 15 минут");
      const u = get(
        "SELECT * FROM users WHERE email=? COLLATE NOCASE",
        text(body.email, "email", true, 254),
      );
      if (!u || !u.active || !verifyPassword(body.password, u.password_hash)) {
        const n = count && count.until > Date.now() ? count.n + 1 : 1;
        loginAttempts.set(key, { n, until: Date.now() + 900000 });
        fail(401, "Неверный email или пароль");
      }
      loginAttempts.delete(key);
      return ctx.tx(() => setSession(req, res, u));
    },
    { public: true },
  );
  add("GET", "/auth/me", ({ user, session }) => ({ user, csrf: session.csrf }));
  add("POST", "/auth/logout", ({ session, res }) => {
    run("DELETE FROM sessions WHERE id=?", session.id);
    res.setHeader(
      "Set-Cookie",
      "bytmarket_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    );
    return { ok: true };
  });
  add("GET", "/meta", ({ user }) => ({
    entities: all("SELECT * FROM entities")
      .filter((e) => has(user, "owner") || user.entity_ids.includes(e.id))
      .map((e) => ({ ...e, details: parse(e.details, {}) })),
    warehouses: all("SELECT * FROM warehouses").filter(
      (w) => has(user, "owner") || user.warehouse_ids.includes(w.id),
    ),
    users: all("SELECT id,name,roles,entity_ids FROM users WHERE active=1")
      .filter(
        (u) =>
          has(user, "owner", "accountant", "dispatcher") || u.id === user.id,
      )
      .map((u) => ({ id: u.id, name: u.name, roles: parse(u.roles) })),
    settings: Object.fromEntries(
      all("SELECT * FROM settings").map((x) => [x.key, parse(x.value, null)]),
    ),
    permissions: {
      ...user.permissions,
      export_data:
        user.roles.includes("owner") ||
        (user.permissions?.export_data ?? has(user, "accountant")),
      can_manage: has(user, "owner"),
      can_finance: finance(user),
      can_stock: has(user, "warehouse"),
      can_sell: has(user, "seller", "manager", "rep"),
    },
  }));
  add("GET", "/settings", ({ user }) => {
    ctx.requireRole(user, "owner");
    return Object.fromEntries(
      all("SELECT * FROM settings").map((x) => [x.key, parse(x.value, null)]),
    );
  });
  add("PATCH", "/settings", ({ user, body }) => {
    ctx.requireRole(user, "owner");
    const allowed = [
      "wholesale_min_qty",
      "low_stock_threshold",
      "wholesale_entity_id",
      "retail_entity_id",
      "allow_credit",
      "legal_transfer_ready",
      "discount_limits",
      "digest_enabled",
      "digest_hour",
      "min_margin_percent",
    ];
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.includes(k)) fail(400, "Неизвестная настройка");
      if (k === "digest_hour" && int(v, k) > 23) fail(400, "Час от 0 до 23");
      if (k === "digest_enabled" && typeof v !== "boolean")
        fail(400, "Ожидается переключатель");
      if (k === "min_margin_percent" && int(v, k) > 100)
        fail(400, "Маржа от 0 до 100");
      if (k === "discount_limits") {
        if (!v || typeof v !== "object" || Array.isArray(v))
          fail(400, "Укажите лимиты скидок");
        for (const [role, limit] of Object.entries(v)) {
          if (
            !["seller", "manager", "rep"].includes(role) ||
            int(limit, role) > 100
          )
            fail(400, "Некорректный лимит скидки");
        }
      }

      if (
        ["wholesale_min_qty", "low_stock_threshold"].includes(k) &&
        v !== null
      )
        int(v, k, k === "wholesale_min_qty" ? 1 : 0);
      if (
        k.endsWith("_entity_id") &&
        !get("SELECT id FROM entities WHERE id=?", v)
      )
        fail(400, "Организация не найдена");
      if (
        ["allow_credit", "legal_transfer_ready"].includes(k) &&
        typeof v !== "boolean"
      )
        fail(400, "Ожидается переключатель");
      run(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        k,
        json(v),
      );
    }
    ctx.audit(user, "update", "settings", "all", body);
    return Object.fromEntries(
      all("SELECT * FROM settings").map((x) => [x.key, parse(x.value, null)]),
    );
  });
  add("GET", "/users", ({ user }) => {
    ctx.requireRole(user, "owner");
    return all("SELECT * FROM users ORDER BY name").map(publicUser);
  });
  add("POST", "/users", ({ user, body }) => {
    ctx.requireRole(user, "owner");
    const f = userFields(body);
    const id = randomUUID();
    run(
      "INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      f.name,
      f.email,
      hashPassword(body.password),
      json(f.roles),
      json(f.es),
      json(f.ws),
      1,
      ctx.now(),
    );
    ctx.audit(user, "create", "user", id, { roles: f.roles });
    return publicUser(get("SELECT * FROM users WHERE id=?", id));
  });
  add("PATCH", "/users/:id", ({ user, body, params }) => {
    ctx.requireRole(user, "owner");
    const old = get("SELECT * FROM users WHERE id=?", params.id);
    if (!old) fail(404, "Пользователь не найден");
    const f = userFields(body, old);
    const active = body.active === undefined ? old.active : body.active ? 1 : 0;
    if (
      parse(old.roles).includes("owner") &&
      (!active || !f.roles.includes("owner")) &&
      !all("SELECT * FROM users WHERE active=1 AND id<>?", old.id).some((u) =>
        parse(u.roles).includes("owner"),
      )
    )
      fail(409, "Нельзя отключить последнего владельца");
    run(
      "UPDATE users SET name=?,email=?,roles=?,entity_ids=?,warehouse_ids=?,active=?,password_hash=? WHERE id=?",
      f.name,
      f.email,
      json(f.roles),
      json(f.es),
      json(f.ws),
      active,
      body.password ? hashPassword(body.password) : old.password_hash,
      old.id,
    );
    run("DELETE FROM sessions WHERE user_id=?", old.id);
    ctx.audit(user, "update", "user", old.id, { roles: f.roles, active });
    return publicUser(get("SELECT * FROM users WHERE id=?", old.id));
  });
  add("POST", "/entities", ({ user, body }) => {
    ctx.requireRole(user, "owner");
    if (!["ooo", "ip"].includes(body.kind)) fail(400, "Укажите ООО или ИП");
    const id = randomUUID();
    run(
      "INSERT INTO entities VALUES(?,?,?,?)",
      id,
      text(body.name, "название", true, 200),
      body.kind,
      json(body.details || {}),
    );
    ctx.audit(user, "create", "entity", id);
    return {
      ...get("SELECT * FROM entities WHERE id=?", id),
      details: body.details || {},
    };
  });
  add("PATCH", "/entities/:id", ({ user, body, params }) => {
    ctx.requireRole(user, "owner");
    const e = get("SELECT * FROM entities WHERE id=?", params.id);
    if (!e) fail(404, "Организация не найдена");
    run(
      "UPDATE entities SET name=?,details=? WHERE id=?",
      text(body.name ?? e.name, "название", true, 200),
      json(body.details ?? parse(e.details, {})),
      e.id,
    );
    ctx.audit(user, "update", "entity", e.id);
    return {
      ...get("SELECT * FROM entities WHERE id=?", e.id),
      details: body.details ?? parse(e.details, {}),
    };
  });
  add("POST", "/warehouses", ({ user, body }) => {
    ctx.requireRole(user, "owner");
    const id = randomUUID();
    run(
      "INSERT INTO warehouses VALUES(?,?)",
      id,
      text(body.name, "название", true, 200),
    );
    ctx.audit(user, "create", "warehouse", id);
    return get("SELECT * FROM warehouses WHERE id=?", id);
  });
  const productBody = (b, old = {}) => {
    const v = { ...old, ...b };
    return {
      sku: text(v.sku, "артикул", true, 100),
      name: text(v.name, "название", true, 300),
      brand: text(v.brand, "бренд", false, 200),
      category: text(v.category, "категория", false, 200),
      barcode: text(v.barcode, "штрихкод", false, 100),
      unit: text(v.unit || "шт.", "единица", true, 30),
      pack_size: int(v.pack_size ?? 1, "в коробке", 1),
      retail_cents: int(v.retail_cents ?? 0, "розничная цена"),
      wholesale_cents: int(v.wholesale_cents ?? 0, "оптовая цена"),
      min_stock: int(v.min_stock ?? 50, "порог"),
      active: v.active === false || v.active === 0 ? 0 : 1,
      attributes: json(
        typeof v.attributes === "string"
          ? parse(v.attributes, {})
          : v.attributes || {},
      ),
      expiry_required: v.expiry_required ? 1 : 0,
      marked: v.marked ? 1 : 0,
    };
  };
  const insertProduct = (b) => {
    const p = productBody(b),
      id = randomUUID();
    run(
      "INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      ...Object.values(p),
      ctx.now(),
    );
    return get("SELECT * FROM products WHERE id=?", id);
  };
  const productView = (user, p, query = {}) => {
    const items = all(
      "SELECT * FROM inventory WHERE product_id=?",
      p.id,
    ).filter(
      (x) =>
        (!query.entity_id || x.entity_id === query.entity_id) &&
        (!query.warehouse_id || x.warehouse_id === query.warehouse_id) &&
        (has(user, "owner") ||
          (user.entity_ids.includes(x.entity_id) &&
            user.warehouse_ids.includes(x.warehouse_id))),
    );
    const sums = items.reduce(
      (s, x) => {
        const b = ctx.balance(x.entity_id, x.warehouse_id, p.id);
        for (const k of ["on_hand", "reserved", "quarantine", "available"])
          s[k] += b[k];
        return s;
      },
      { on_hand: 0, reserved: 0, quarantine: 0, available: 0 },
    );
    return {
      ...p,
      attributes: parse(p.attributes, {}),
      active: !!p.active,
      expiry_required: !!p.expiry_required,
      marked: !!p.marked,
      ...sums,
    };
  };
  add("GET", "/products", ({ user, query }) => {
    ctx.requireRole(
      user,
      "seller",
      "manager",
      "rep",
      "accountant",
      "warehouse",
    );
    if (query.entity_id || query.warehouse_id)
      ctx.scope(user, query.entity_id, query.warehouse_id);
    const q = String(query.q || "").toLowerCase();
    return all("SELECT * FROM products ORDER BY name")
      .filter(
        (p) =>
          !q || `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q),
      )
      .map((p) => productView(user, p, query));
  });
  add("POST", "/products", ({ user, body }) => {
    ctx.requireRole(user, "owner");
    const p = insertProduct(body);
    ctx.audit(user, "create", "product", p.id);
    return productView(user, p);
  });
  add("PATCH", "/products/:id", ({ user, body, params }) => {
    ctx.requireRole(user, "owner");
    const old = get("SELECT * FROM products WHERE id=?", params.id);
    if (!old) fail(404, "Товар не найден");
    const p = productBody(body, old);
    run(
      `UPDATE products SET ${Object.keys(p)
        .map((k) => k + "=?")
        .join(",")} WHERE id=?`,
      ...Object.values(p),
      old.id,
    );
    for (const i of all("SELECT * FROM inventory WHERE product_id=?", old.id))
      ctx.refreshAlerts(i.entity_id, i.warehouse_id, old.id);
    ctx.audit(user, "update", "product", old.id, { fields: Object.keys(body) });
    return productView(user, get("SELECT * FROM products WHERE id=?", old.id));
  });
  const preview = (rows) => {
    if (!Array.isArray(rows) || !rows.length || rows.length > 5000)
      fail(400, "Импорт: от 1 до 5000 строк");
    const normalized = [],
      errors = [],
      skus = new Set(),
      barcodes = new Set();
    rows.forEach((row, i) => {
      try {
        const p = productBody(row);
        if (
          skus.has(p.sku) ||
          get("SELECT id FROM products WHERE sku=?", p.sku)
        )
          fail(400, "Артикул уже существует");
        if (
          p.barcode &&
          (barcodes.has(p.barcode) ||
            get("SELECT id FROM products WHERE barcode=?", p.barcode))
        )
          fail(400, "Штрихкод уже существует");
        skus.add(p.sku);
        barcodes.add(p.barcode);
        normalized.push(p);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    });
    return {
      valid: !errors.length,
      count: rows.length,
      errors,
      preview_hash: createHash("sha256").update(json(rows)).digest("hex"),
      rows: normalized,
    };
  };
  add("POST", "/products/import/preview", ({ user, body }) => {
    ctx.requireRole(user, "owner");
    return preview(body.rows);
  });
  add("POST", "/products/import", ({ user, body }) => {
    ctx.requireRole(user, "owner");
    const result = preview(body.rows);
    if (!result.valid)
      fail(
        400,
        "Импорт содержит ошибки: " +
          result.errors.map((e) => e.row + ": " + e.error).join("; "),
      );
    if (body.preview_hash !== result.preview_hash)
      fail(409, "Повторите предварительную проверку импорта");
    const imported = body.rows.map(insertProduct);
    ctx.audit(user, "import", "products", "batch", { count: imported.length });
    return {
      count: imported.length,
      products: imported.map((p) => productView(user, p)),
    };
  });
  const clientBody = (u, b, old = {}) => {
    const v = { ...old, ...b };
    if (
      ![
        "customer",
        "supplier",
        "retail",
        "wholesale",
        "individual",
        "company",
      ].includes(v.kind || "customer")
    )
      fail(400, "Неизвестный тип клиента");
    if (v.kind === "supplier") ctx.requireRole(u, "owner", "accountant");
    let assigned = v.assigned_to ?? old.assigned_to ?? u.id;
    if (!has(u, "owner") && assigned !== u.id && assigned !== old.assigned_to)
      fail(403, "Нельзя назначить чужого клиента");
    if (
      assigned &&
      !get("SELECT id FROM users WHERE id=? AND active=1", assigned)
    )
      fail(400, "Ответственный не найден");
    if (
      !has(u, "owner", "accountant") &&
      ((b.credit_limit_cents !== undefined &&
        b.credit_limit_cents !== old.credit_limit_cents) ||
        (b.term_days !== undefined && b.term_days !== old.term_days))
    )
      fail(403, "Условия кредита изменяет владелец/бухгалтер");
    for (const key of ["contacts", "addresses"]) {
      if (v[key] === undefined) continue;
      if (typeof v[key] === "string") {
        try {
          v[key] = JSON.parse(v[key]);
        } catch {
          fail(400, "Некорректный список " + key);
        }
      }
      if (!Array.isArray(v[key]) || v[key].length > 100)
        fail(400, "До 100 контактов или адресов");
      v[key] = v[key].map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          fail(400, "Некорректная запись " + key);
        return key === "contacts"
          ? {
              name: text(item.name, "имя контакта", true, 200),
              phone: text(item.phone, "телефон", false, 100),
              email: text(item.email, "email", false, 254),
            }
          : {
              name: text(item.name, "название точки", true, 200),
              address: text(item.address, "адрес", true, 1000),
            };
      });
    }
    return {
      name: text(v.name, "название", true, 300),
      kind: v.kind || "customer",
      phone: text(v.phone, "телефон", false, 100),
      email: text(v.email, "email", false, 254),
      address: text(v.address, "адрес", false, 1000),
      inn: text(v.inn, "ИНН", false, 20),
      assigned_to: assigned || null,
      credit_limit_cents:
        v.credit_limit_cents == null
          ? null
          : int(v.credit_limit_cents, "лимит"),
      term_days: v.term_days == null ? null : int(v.term_days, "отсрочка"),
      notes: text(v.notes, "заметка"),
      contacts:
        typeof v.contacts === "string" ? v.contacts : json(v.contacts || []),
      addresses:
        typeof v.addresses === "string" ? v.addresses : json(v.addresses || []),
    };
  };
  const clientView = (c) => ({
    ...c,
    contacts: parse(c.contacts),
    addresses: parse(c.addresses),
  });
  add("GET", "/clients", ({ user }) => {
    ctx.requireRole(user, "seller", "manager", "rep", "accountant");
    return all("SELECT * FROM clients ORDER BY name")
      .filter((c) => ctx.canClient(user, c))
      .map(clientView);
  });
  add("POST", "/clients", ({ user, body }) => {
    ctx.requireRole(user, "seller", "manager", "rep", "accountant");
    const c = clientBody(user, body),
      id = randomUUID();
    run(
      "INSERT INTO clients VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      ...Object.values(c),
      ctx.now(),
    );
    ctx.audit(user, "create", "client", id);
    return clientView(get("SELECT * FROM clients WHERE id=?", id));
  });
  add("PATCH", "/clients/:id", ({ user, body, params }) => {
    ctx.requireRole(user, "seller", "manager", "rep", "accountant");
    const old = get("SELECT * FROM clients WHERE id=?", params.id);
    if (!old || !ctx.canClient(user, old)) fail(404, "Клиент не найден");
    const c = clientBody(user, body, old);
    run(
      `UPDATE clients SET ${Object.keys(c)
        .map((k) => k + "=?")
        .join(",")} WHERE id=?`,
      ...Object.values(c),
      old.id,
    );
    ctx.audit(user, "update", "client", old.id, { fields: Object.keys(body) });
    return clientView(get("SELECT * FROM clients WHERE id=?", old.id));
  });
  const scopeRows = (u, rows) =>
    rows.filter(
      (x) =>
        has(u, "owner") ||
        (u.entity_ids.includes(x.entity_id) &&
          (!x.warehouse_id || u.warehouse_ids.includes(x.warehouse_id))),
    );
  const stockAccess = (u) =>
    ctx.requireRole(u, "warehouse", "accountant", "seller", "manager", "rep");
  add("GET", "/stock", ({ user, query }) => {
    stockAccess(user);
    if (query.entity_id || query.warehouse_id)
      ctx.scope(user, query.entity_id, query.warehouse_id);
    return scopeRows(
      user,
      all(
        "SELECT i.*,p.name,p.sku,p.unit,p.pack_size FROM inventory i JOIN products p ON p.id=i.product_id",
      ),
    )
      .filter(
        (i) =>
          (!query.entity_id || query.entity_id === i.entity_id) &&
          (!query.warehouse_id || query.warehouse_id === i.warehouse_id),
      )
      .map((i) => {
        const r = {
          ...i,
          ...ctx.balance(i.entity_id, i.warehouse_id, i.product_id),
        };
        if (!finance(user)) delete r.cost_cents;
        return r;
      });
  });
  add("GET", "/stock/movements", ({ user, query }) => {
    ctx.requireRole(user, "warehouse", "accountant");
    if (query.entity_id || query.warehouse_id)
      ctx.scope(user, query.entity_id, query.warehouse_id);
    return scopeRows(
      user,
      all(
        "SELECT m.*,p.name,p.sku FROM stock_movements m JOIN products p ON p.id=m.product_id ORDER BY created_at DESC LIMIT 2000",
      ),
    )
      .filter(
        (m) =>
          (!query.entity_id || m.entity_id === query.entity_id) &&
          (!query.warehouse_id || m.warehouse_id === query.warehouse_id),
      )
      .map((m) => {
        if (!finance(user)) {
          delete m.cost_cents;
          delete m.revenue_cents;
        }
        return m;
      });
  });
  add("POST", "/stock/receive", ({ user, body }) => {
    const r = ctx.stockReceive(user, body);
    if (!finance(user)) delete r.cost_cents;
    return r;
  });
  const stockBase = (user, b) => {
    ctx.requireRole(user, "warehouse");
    ctx.scope(user, b.entity_id, b.warehouse_id);
    if (!get("SELECT id FROM products WHERE id=?", b.product_id))
      fail(404, "Товар не найден");
    text(b.reason, "основание", true);
  };
  add("POST", "/stock/adjust", ({ user, body: b }) => {
    ctx.requireRole(user, "owner");
    stockBase(user, b);
    int(b.qty, "количество", -1e12);
    if (!b.qty) fail(400, "Укажите ненулевое изменение");
    if (b.qty > 0) return ctx.stockReceive(user, b);
    let need = -b.qty;
    if (ctx.balance(b.entity_id, b.warehouse_id, b.product_id).available < need)
      fail(409, "Недостаточно свободного товара");
    for (const batch of all(
      "SELECT * FROM stock_batches WHERE entity_id=? AND warehouse_id=? AND product_id=? AND qty>reserved AND (expires_at IS NULL OR expires_at>=?) ORDER BY expires_at IS NULL,expires_at,created_at",
      b.entity_id,
      b.warehouse_id,
      b.product_id,
      ctx.now().slice(0, 10),
    )) {
      const take = Math.min(need, batch.qty - batch.reserved);
      if (!take) continue;
      run("UPDATE stock_batches SET qty=qty-? WHERE id=?", take, batch.id);
      ctx.movement(user, batch, -take, "adjust", b.reason);
      need -= take;
      if (!need) break;
    }
    ctx.syncInventory(b.entity_id, b.warehouse_id, b.product_id);
    ctx.audit(user, "adjust", "stock", b.product_id, {
      qty: b.qty,
      reason: b.reason,
    });
    return ctx.balance(b.entity_id, b.warehouse_id, b.product_id);
  });
  add("POST", "/stock/transfer", ({ user, body: b }) => {
    stockBase(user, b);
    ctx.scope(user, b.entity_id, b.to_warehouse_id);
    if (b.warehouse_id === b.to_warehouse_id)
      fail(400, "Выберите другой склад");
    if (b.to_entity_id && b.to_entity_id !== b.entity_id)
      fail(400, "Смена владельца не является складским перемещением");
    let need = int(b.qty, "количество", 1);
    if (ctx.balance(b.entity_id, b.warehouse_id, b.product_id).available < need)
      fail(409, "Недостаточно свободного товара");
    for (const batch of all(
      "SELECT * FROM stock_batches WHERE entity_id=? AND warehouse_id=? AND product_id=? AND qty>reserved AND (expires_at IS NULL OR expires_at>=?) ORDER BY expires_at IS NULL,expires_at,created_at",
      b.entity_id,
      b.warehouse_id,
      b.product_id,
      ctx.now().slice(0, 10),
    )) {
      const take = Math.min(need, batch.qty - batch.reserved);
      if (!take) continue;
      run("UPDATE stock_batches SET qty=qty-? WHERE id=?", take, batch.id);
      run(
        "INSERT INTO stock_batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        randomUUID(),
        b.entity_id,
        b.to_warehouse_id,
        b.product_id,
        batch.batch_number,
        batch.expires_at,
        batch.supplier_id,
        take,
        0,
        0,
        batch.cost_cents,
        ctx.now(),
      );
      ctx.movement(user, batch, -take, "transfer_out", b.reason);
      ctx.movement(
        user,
        { ...batch, warehouse_id: b.to_warehouse_id },
        take,
        "transfer_in",
        b.reason,
      );
      need -= take;
      if (!need) break;
    }
    ctx.syncInventory(b.entity_id, b.warehouse_id, b.product_id);
    ctx.syncInventory(b.entity_id, b.to_warehouse_id, b.product_id);
    ctx.audit(user, "transfer", "stock", b.product_id, {
      qty: b.qty,
      from: b.warehouse_id,
      to: b.to_warehouse_id,
      entity: b.entity_id,
    });
    return { ok: true };
  });
  add("POST", "/stock/release", ({ user, body: b }) => {
    ctx.requireRole(user, "owner");
    stockBase(user, b);
    const p = get("SELECT * FROM products WHERE id=?", b.product_id);
    if (p.marked)
      fail(409, "Маркировка не подключена: выпуск в продажу запрещён");
    let need = int(b.qty, "количество", 1);
    const batches = all(
      "SELECT * FROM stock_batches WHERE entity_id=? AND warehouse_id=? AND product_id=? AND quarantine>0 AND (expires_at IS NULL OR expires_at>=?) ORDER BY created_at",
      b.entity_id,
      b.warehouse_id,
      b.product_id,
      ctx.now().slice(0, 10),
    );
    if (batches.reduce((s, x) => s + x.quarantine, 0) < need)
      fail(409, "Недостаточно непросроченного товара в карантине");
    for (const batch of batches) {
      const take = Math.min(need, batch.quarantine);
      run(
        "UPDATE stock_batches SET qty=qty+?,quarantine=quarantine-? WHERE id=?",
        take,
        take,
        batch.id,
      );
      ctx.movement(user, batch, take, "release", b.reason);
      need -= take;
      if (!need) break;
    }
    ctx.syncInventory(b.entity_id, b.warehouse_id, b.product_id);
    ctx.audit(user, "release", "stock", b.product_id, {
      qty: b.qty,
      reason: b.reason,
    });
    return ctx.balance(b.entity_id, b.warehouse_id, b.product_id);
  });
  const createOrder = (u, b) => {
    const q = ctx.quote(u, b);
    const id = randomUUID(),
      now = ctx.now();
    const number =
      "БМ-" +
      String(get("SELECT COUNT(*) n FROM orders").n + 1).padStart(6, "0");
    const due = date(b.due_date, "дата оплаты");
    run(
      "INSERT INTO orders(id,number,entity_id,warehouse_id,client_id,channel,status,total_cents,notes,fulfillment,address,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)",
      id,
      number,
      b.entity_id,
      b.warehouse_id,
      b.client_id || null,
      b.channel,
      "draft",
      q.total,
      text(b.notes, "заметка"),
      b.fulfillment,
      text(b.address, "адрес", false, 1000),
      due,
      u.id,
      now,
      now,
    );
    ctx.saveLines(id, q.lines);
    ctx.audit(u, "create", "order", id);
    return ctx.orderView(u, id);
  };
  add("GET", "/orders", ({ user, query }) => {
    ctx.requireRole(
      user,
      "seller",
      "manager",
      "rep",
      "accountant",
      "warehouse",
      "dispatcher",
    );
    if (query.entity_id) ctx.scope(user, query.entity_id);
    return all("SELECT id FROM orders ORDER BY created_at DESC LIMIT 2000")
      .map((o) => {
        try {
          return ctx.orderView(user, o.id);
        } catch (e) {
          if (e.status === 403) return null;
          throw e;
        }
      })
      .filter(
        (o) => o && (!query.entity_id || o.entity_id === query.entity_id),
      );
  });
  add("POST", "/orders", ({ user, body }) => createOrder(user, body));
  add("GET", "/orders/:id", ({ user, params }) =>
    ctx.orderView(user, params.id),
  );
  add("PATCH", "/orders/:id", ({ user, body, params }) => {
    ctx.requireRole(user, "seller", "manager", "rep");
    const old = ctx.orderView(user, params.id);
    if (old.status !== "draft") fail(409, "Изменять можно только черновик");
    if (body.version !== old.version)
      fail(409, "Заказ изменён другим сотрудником, обновите данные");
    const b = { ...old, ...body };
    if (!body.lines)
      b.lines = old.lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit: l.unit,
        discount_percent: l.promotion_id ? 0 : l.discount_percent,
      }));
    const q = ctx.quote(user, b);
    ctx.saveLines(old.id, q.lines);
    run(
      "UPDATE orders SET entity_id=?,warehouse_id=?,client_id=?,channel=?,total_cents=?,notes=?,fulfillment=?,address=?,due_date=?,version=version+1,updated_at=? WHERE id=?",
      b.entity_id,
      b.warehouse_id,
      b.client_id || null,
      b.channel,
      q.total,
      text(b.notes, "заметка"),
      b.fulfillment,
      text(b.address, "адрес", false, 1000),
      date(b.due_date, "дата оплаты"),
      ctx.now(),
      old.id,
    );
    ctx.audit(user, "update", "order", old.id, { version: old.version + 1 });
    return ctx.orderView(user, old.id);
  });
  add("POST", "/orders/:id/confirm", ({ user, params }) => {
    ctx.requireRole(user, "seller", "manager", "rep");
    const o = ctx.orderView(user, params.id);
    if (o.status !== "draft") fail(409, "Заказ уже подтверждён или закрыт");
    const entity = ctx.setting(
      o.channel === "wholesale" ? "wholesale_entity_id" : "retail_entity_id",
    );
    if (entity !== o.entity_id)
      fail(409, "Организация не соответствует розничной/оптовой политике");
    if (o.channel === "wholesale") {
      const min = ctx.setting("wholesale_min_qty");
      if (min == null)
        fail(
          409,
          "Владелец должен настроить минимальный оптовый заказ в штуках",
        );
      if (o.lines.reduce((s, l) => s + l.qty, 0) < min)
        fail(400, `Минимум опта: ${min} шт.`);
    }
    if (o.fulfillment === "delivery" && !o.address)
      fail(400, "Укажите адрес доставки");
    const fresh = ctx.quote(user, {
      ...o,
      lines: o.lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit: l.unit,
        discount_percent: l.promotion_id ? 0 : l.discount_percent,
      })),
    });
    if (
      fresh.lines.some(
        (l, i) =>
          l.qty !== o.lines[i].qty ||
          l.unit_price_cents !== o.lines[i].unit_price_cents ||
          l.unit_factor !== o.lines[i].unit_factor,
      )
    )
      fail(
        409,
        "Цены или упаковки изменились: пересохраните черновик и проверьте итог",
      );
    ctx.checkPricePolicy?.(user, o);
    for (const l of o.lines) {
      const p = get("SELECT * FROM products WHERE id=?", l.product_id);
      if (p.marked)
        fail(409, "Проверка маркировки не подключена: продажа запрещена");
      if (
        ctx.balance(o.entity_id, o.warehouse_id, l.product_id).available < l.qty
      )
        fail(409, `Недостаточно товара: ${l.name}`);
      let need = l.qty,
        totalCost = 0,
        known = true;
      const batches = all(
        "SELECT * FROM stock_batches WHERE entity_id=? AND warehouse_id=? AND product_id=? AND qty>reserved AND (expires_at IS NULL OR expires_at>=?) ORDER BY expires_at IS NULL,expires_at,created_at,id",
        o.entity_id,
        o.warehouse_id,
        l.product_id,
        ctx.now().slice(0, 10),
      );
      for (const b of batches) {
        const take = Math.min(need, b.qty - b.reserved);
        if (!take) continue;
        run(
          "UPDATE stock_batches SET reserved=reserved+? WHERE id=?",
          take,
          b.id,
        );
        run(
          "INSERT INTO order_batch_allocations VALUES(?,?,?,?,?,?,?)",
          randomUUID(),
          l.id,
          b.id,
          take,
          0,
          0,
          b.cost_cents,
        );
        if (b.cost_cents == null) known = false;
        else totalCost += take * b.cost_cents;
        need -= take;
        if (!need) break;
      }
      if (need) fail(409, "Конфликт доступности");
      run(
        "UPDATE order_lines SET cost_cents=? WHERE id=?",
        known ? Math.round(totalCost / l.qty) : null,
        l.id,
      );
      ctx.syncInventory(o.entity_id, o.warehouse_id, l.product_id);
    }
    run(
      "UPDATE orders SET status='confirmed',version=version+1,updated_at=? WHERE id=?",
      ctx.now(),
      o.id,
    );
    ctx.audit(user, "confirm", "order", o.id);
    return ctx.orderView(user, o.id);
  });
  add("POST", "/orders/:id/cancel", ({ user, params, body }) => {
    ctx.requireRole(user, "seller", "manager", "rep");
    const o = ctx.orderView(user, params.id);
    if (["cancelled", "shipped"].includes(o.status))
      fail(409, "Заказ уже закрыт; для отгруженного оформите возврат");
    for (const l of o.lines) {
      for (const a of all(
        "SELECT * FROM order_batch_allocations WHERE line_id=?",
        l.id,
      )) {
        const free = a.qty - a.shipped_qty;
        if (free)
          run(
            "UPDATE stock_batches SET reserved=reserved-? WHERE id=?",
            free,
            a.batch_id,
          );
        run(
          "UPDATE order_batch_allocations SET qty=shipped_qty WHERE id=?",
          a.id,
        );
      }
      ctx.syncInventory(o.entity_id, o.warehouse_id, l.product_id);
    }
    run(
      "UPDATE orders SET status='cancelled',version=version+1,updated_at=? WHERE id=?",
      ctx.now(),
      o.id,
    );
    ctx.audit(user, "cancel", "order", o.id, {
      reason: text(body.reason, "причина"),
    });
    return ctx.orderView(user, o.id);
  });
  const selectedLines = (o, body, mode) => {
    if (body.lines == null && mode === "ship")
      return o.lines
        .map((l) => ({ line_id: l.id, qty: l.qty - l.shipped_qty }))
        .filter((l) => l.qty > 0);
    if (!Array.isArray(body.lines) || !body.lines.length)
      fail(400, "Укажите строки и количества");
    const seen = new Set();
    return body.lines.map((x) => {
      int(x.qty, "количество", 1);
      if (seen.has(x.line_id) || !o.lines.some((l) => l.id === x.line_id))
        fail(400, "Некорректная строка заказа");
      seen.add(x.line_id);
      return x;
    });
  };
  add("POST", "/orders/:id/ship", ({ user, body, params }) => {
    ctx.requireRole(user, "warehouse", "seller");
    ctx.orderView(user, params.id);
    const o = {
      ...get("SELECT * FROM orders WHERE id=?", params.id),
      lines: all("SELECT * FROM order_lines WHERE order_id=?", params.id),
    };
    if (!["confirmed", "partially_shipped"].includes(o.status))
      fail(409, "Заказ не готов к отгрузке");
    const selected = selectedLines(o, body, "ship");
    if (!selected.length) fail(409, "Нет неотгруженных строк");
    let shipment = 0;
    for (const x of selected) {
      const l = o.lines.find((l) => l.id === x.line_id);
      if (x.qty > l.qty - l.shipped_qty)
        fail(400, "Количество превышает остаток к отгрузке");
      const raw = get("SELECT * FROM order_lines WHERE id=?", l.id);
      shipment += x.qty * raw.unit_price_cents;
    }
    const unpaid = Math.max(
      0,
      o.shipped_cents +
        shipment -
        o.returned_cents -
        (o.paid_cents - o.refunded_cents),
    );
    const cod =
      o.fulfillment === "delivery" &&
      get(
        "SELECT d.id FROM deliveries d JOIN users u ON u.id=d.courier_id WHERE d.order_id=? AND d.collect_on_delivery=1 AND d.status='assigned' AND u.active=1",
        o.id,
      );
    if (unpaid > 0 && !cod && !ctx.approved?.(o.id, o.version, "credit")) {
      const client = o.client_id
        ? get("SELECT * FROM clients WHERE id=?", o.client_id)
        : null;
      if (
        !ctx.setting("allow_credit") ||
        !client ||
        client.term_days == null ||
        client.credit_limit_cents == null ||
        !o.due_date
      )
        fail(
          409,
          "До отгрузки требуется оплата либо настроенные срок, лимит отсрочки и дата оплаты",
        );
      const today = new Date(Date.parse(ctx.now()) + 4 * 3600000)
        .toISOString()
        .slice(0, 10);
      const maxDue = new Date(
        Date.parse(o.created_at) + (client.term_days * 24 + 4) * 3600000,
      )
        .toISOString()
        .slice(0, 10);
      if (o.due_date < today || o.due_date > maxDue)
        fail(
          409,
          "Дата оплаты выходит за условия отсрочки. Запросите согласование владельца.",
        );
      const other = get(
        "SELECT COALESCE(SUM(MAX(0,shipped_cents-returned_cents-paid_cents+refunded_cents)),0) debt FROM orders WHERE client_id=? AND entity_id=? AND id<>?",
        o.client_id,
        o.entity_id,
        o.id,
      ).debt;
      const opening = ctx.openingDebt?.(o.entity_id, o.client_id) || 0;
      const overdue = get(
        "SELECT id FROM orders WHERE client_id=? AND entity_id=? AND due_date<? AND shipped_cents-returned_cents-paid_cents+refunded_cents>0 LIMIT 1",
        o.client_id,
        o.entity_id,
        ctx.now().slice(0, 10),
      );
      if (overdue)
        fail(
          409,
          "Есть просроченная задолженность. Требуется согласование отгрузки.",
        );
      if (other + opening + unpaid > client.credit_limit_cents)
        fail(409, "Превышен кредитный лимит");
    }
    for (const x of selected) {
      const l = get("SELECT * FROM order_lines WHERE id=?", x.line_id);
      const product = get("SELECT * FROM products WHERE id=?", l.product_id);
      if (!product.active || product.marked)
        fail(
          409,
          "Товар отключён или требует неподключённой проверки маркировки",
        );
      let need = x.qty;
      for (const a of all(
        "SELECT a.*,b.expires_at,b.entity_id,b.warehouse_id,b.product_id FROM order_batch_allocations a JOIN stock_batches b ON b.id=a.batch_id WHERE a.line_id=? AND a.qty>a.shipped_qty ORDER BY b.created_at,a.id",
        l.id,
      )) {
        const take = Math.min(need, a.qty - a.shipped_qty);
        if (
          (product.expiry_required && !a.expires_at) ||
          (a.expires_at && a.expires_at < ctx.now().slice(0, 10))
        )
          fail(
            409,
            "Зарезервированная партия просрочена, снимите резерв и пересоберите заказ",
          );
        run(
          "UPDATE stock_batches SET qty=qty-?,reserved=reserved-? WHERE id=?",
          take,
          take,
          a.batch_id,
        );
        run(
          "UPDATE order_batch_allocations SET shipped_qty=shipped_qty+? WHERE id=?",
          take,
          a.id,
        );
        const mid = ctx.movement(
          user,
          a,
          -take,
          "ship",
          "Отгрузка " + o.number,
          o.id,
        );
        run(
          "UPDATE stock_movements SET revenue_cents=?,order_line_id=? WHERE id=?",
          take * l.unit_price_cents,
          l.id,
          mid,
        );
        need -= take;
        if (!need) break;
      }
      if (need) fail(409, "Резерв не соответствует отгрузке");
      run(
        "UPDATE order_lines SET shipped_qty=shipped_qty+? WHERE id=?",
        x.qty,
        l.id,
      );
      ctx.syncInventory(o.entity_id, o.warehouse_id, l.product_id);
    }
    const rest = get(
      "SELECT SUM(qty-shipped_qty) n FROM order_lines WHERE order_id=?",
      o.id,
    ).n;
    run(
      "UPDATE orders SET status=?,shipped_cents=shipped_cents+?,version=version+1,updated_at=? WHERE id=?",
      rest ? "partially_shipped" : "shipped",
      shipment,
      ctx.now(),
      o.id,
    );
    run(
      "UPDATE packing SET status=?,lines='{}',updated_at=? WHERE order_id=?",
      rest ? "not_started" : "shipped",
      ctx.now(),
      o.id,
    );
    ctx.audit(user, "ship", "order", o.id, {
      lines: selected,
      collect_on_delivery: !!cod,
    });
    return ctx.orderView(user, o.id);
  });
  add("POST", "/orders/:id/return", ({ user, body, params }) => {
    ctx.requireRole(user, "owner", "warehouse");
    const o = ctx.orderView(user, params.id),
      reason = text(body.reason, "причина возврата", true);
    const selected = selectedLines(o, body, "return");
    let value = 0;
    for (const x of selected) {
      const l = get("SELECT * FROM order_lines WHERE id=?", x.line_id);
      if (x.qty > l.shipped_qty - l.returned_qty)
        fail(409, "Возврат превышает отгруженное количество");
      let need = x.qty;
      for (const a of all(
        "SELECT a.*,b.entity_id,b.warehouse_id,b.product_id,b.batch_number,b.expires_at,b.supplier_id FROM order_batch_allocations a JOIN stock_batches b ON b.id=a.batch_id WHERE a.line_id=? AND a.shipped_qty>a.returned_qty ORDER BY a.id",
        l.id,
      )) {
        const take = Math.min(need, a.shipped_qty - a.returned_qty);
        run(
          "INSERT INTO stock_batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          randomUUID(),
          o.entity_id,
          o.warehouse_id,
          l.product_id,
          a.batch_number,
          a.expires_at,
          a.supplier_id,
          0,
          0,
          take,
          a.cost_cents,
          ctx.now(),
        );
        run(
          "UPDATE order_batch_allocations SET returned_qty=returned_qty+? WHERE id=?",
          take,
          a.id,
        );
        const mid = ctx.movement(user, a, take, "return", reason, o.id);
        run(
          "UPDATE stock_movements SET revenue_cents=?,order_line_id=? WHERE id=?",
          -take * l.unit_price_cents,
          l.id,
          mid,
        );
        need -= take;
        if (!need) break;
      }
      if (need) fail(409, "Нет исходной отгрузки");
      run(
        "UPDATE order_lines SET returned_qty=returned_qty+? WHERE id=?",
        x.qty,
        l.id,
      );
      value += x.qty * l.unit_price_cents;
      ctx.syncInventory(o.entity_id, o.warehouse_id, l.product_id);
    }
    run(
      "UPDATE orders SET returned_cents=returned_cents+?,version=version+1,updated_at=? WHERE id=?",
      value,
      ctx.now(),
      o.id,
    );
    ctx.audit(user, "return", "order", o.id, { reason, lines: selected });
    return ctx.orderView(user, o.id);
  });
  add("POST", "/orders/:id/repeat", ({ user, params }) => {
    ctx.requireRole(user, "seller", "manager", "rep");
    const o = ctx.orderView(user, params.id);
    const lines = o.lines.map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      unit: l.unit,
    }));
    const result = createOrder(user, {
      ...o,
      lines,
      due_date: null,
      notes: "Повтор " + o.number,
    });
    return {
      ...result,
      changes: result.lines.map((l, i) => ({
        product_id: l.product_id,
        old_price_cents: o.lines[i].unit_price_cents,
        new_price_cents: l.unit_price_cents,
        old_qty: o.lines[i].qty,
        new_qty: l.qty,
        available: ctx.balance(o.entity_id, o.warehouse_id, l.product_id)
          .available,
      })),
    };
  });
  add("GET", "/alerts", ({ user }) => {
    ctx.requireRole(user, "owner");
    ctx.tx(() => {
      for (const i of all("SELECT * FROM inventory"))
        ctx.refreshAlerts(i.entity_id, i.warehouse_id, i.product_id);
    });
    return all(
      "SELECT a.*,p.name,p.sku FROM alerts a JOIN products p ON p.id=a.product_id ORDER BY a.created_at DESC LIMIT 1000",
    );
  });
  add("POST", "/alerts/:id/read", ({ user, params, body }) => {
    ctx.requireRole(user, "owner");
    const a = get("SELECT * FROM alerts WHERE id=?", params.id);
    if (!a) fail(404, "Сигнал не найден");
    if (
      body.assigned_to &&
      !get("SELECT id FROM users WHERE id=? AND active=1", body.assigned_to)
    )
      fail(400, "Ответственный не найден");
    run(
      "UPDATE alerts SET read_at=?,assigned_to=COALESCE(?,assigned_to) WHERE id=?",
      ctx.now(),
      body.assigned_to || null,
      a.id,
    );
    ctx.audit(user, "read", "alert", a.id, {
      assigned_to: body.assigned_to || null,
    });
    return get("SELECT * FROM alerts WHERE id=?", a.id);
  });
}
