import { initCompletion } from "./completion.mjs";
export function initExtensions(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),client_id TEXT REFERENCES clients(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL, collected_by TEXT NOT NULL REFERENCES users(id),reference TEXT,note TEXT,created_at TEXT NOT NULL,held_in_custody INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS payment_allocations(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),order_id TEXT NOT NULL REFERENCES orders(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0));
    CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),order_id TEXT NOT NULL REFERENCES orders(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),category TEXT NOT NULL,note TEXT,date TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cash_handovers(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),user_id TEXT NOT NULL REFERENCES users(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),status TEXT NOT NULL,note TEXT,confirmed_by TEXT,created_at TEXT NOT NULL,confirmed_at TEXT);
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),courier_id TEXT REFERENCES users(id),address TEXT NOT NULL,phone TEXT,interval TEXT,note TEXT,places INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),user_id TEXT NOT NULL REFERENCES users(id),scheduled_at TEXT NOT NULL,note TEXT,status TEXT NOT NULL,result TEXT,reason TEXT,next_date TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),supplier_id TEXT REFERENCES clients(id),expected_at TEXT,notes TEXT,status TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,received_at TEXT);
    CREATE TABLE IF NOT EXISTS purchase_lines(id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchases(id),product_id TEXT NOT NULL REFERENCES products(id),qty INTEGER NOT NULL CHECK(qty>0),cost_cents INTEGER NOT NULL CHECK(cost_cents>=0),batch_number TEXT,expires_at TEXT);
    CREATE TABLE IF NOT EXISTS promotions(id TEXT PRIMARY KEY,name TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,discount_percent REAL NOT NULL,product_ids TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS payments_entity ON payments(entity_id,created_at);
    CREATE INDEX IF NOT EXISTS allocations_order ON payment_allocations(order_id);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(deliveries)")
      .all()
      .some((c) => c.name === "collect_on_delivery")
  )
    db.exec(
      "ALTER TABLE deliveries ADD COLUMN collect_on_delivery INTEGER NOT NULL DEFAULT 0",
    );
  if (
    !db
      .prepare("PRAGMA table_info(payments)")
      .all()
      .some((c) => c.name === "held_in_custody")
  ) {
    db.exec(
      "ALTER TABLE payments ADD COLUMN held_in_custody INTEGER NOT NULL DEFAULT 0",
    );
    db.exec(
      "UPDATE payments SET held_in_custody=1 WHERE method='cash' AND collected_by IN (SELECT id FROM users WHERE EXISTS (SELECT 1 FROM json_each(users.roles) WHERE value IN ('rep','courier')))",
    );
  }
  initCompletion(db);
}

export function registerExtensions(add, ctx) {
  const { db, tx, id, now, error, requireRole, scope, audit } = ctx;
  const all = (sql, ...args) => db.prepare(sql).all(...args),
    one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const has = (u, ...roles) => u.roles.some((r) => roles.includes(r));
  const finance = (u) => has(u, "owner", "accountant");
  const fail = (message, status = 400) => {
    throw error(status, message);
  };
  const text = (v, label, required = false) => {
    if (v == null && !required) return "";
    if (typeof v !== "string" || v.length > 4000 || (required && !v.trim()))
      fail(`Некорректно: ${label}`);
    return v.trim();
  };
  const integer = (v, label, min = 1) => {
    if (!Number.isSafeInteger(v) || v < min || v > 1e12)
      fail(`Некорректно: ${label}`);
    return v;
  };
  const date = (v, label) => {
    if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
      fail(`Некорректно: ${label}`);
    return v;
  };
  const getOrder = (u, oid) => {
    const o = one("SELECT * FROM orders WHERE id=?", oid);
    if (!o) fail("Заказ не найден", 404);
    scope(u, o.entity_id, o.warehouse_id);
    if (ctx.canOrder(u, o) === false) fail("Нет доступа к заказу", 403);
    return o;
  };
  const entity = (u, e) => {
    if (!e || !one("SELECT id FROM entities WHERE id=?", e))
      fail("Организация не найдена");
    scope(u, e);
    return e;
  };
  const visible = (u, e, w) =>
    has(u, "owner") ||
    (u.entity_ids.includes(e) && (!w || u.warehouse_ids.includes(w)));
  const balance = (uid, e) =>
    Number(
      one(
        `SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE collected_by=? AND entity_id=? AND method='cash' AND held_in_custody=1`,
        uid,
        e,
      ).n,
    ) -
    Number(
      one(
        `SELECT COALESCE(SUM(amount_cents),0) n FROM cash_handovers WHERE user_id=? AND entity_id=? AND status='confirmed'`,
        uid,
        e,
      ).n,
    );
  const custody = balance;
  const clientAccess = (u, cid) => {
    const c = one("SELECT * FROM clients WHERE id=?", cid);
    if (!c) fail("Клиент не найден", 404);
    if (!has(u, "owner", "accountant") && c.assigned_to !== u.id)
      fail("Нет доступа к клиенту", 403);
    return c;
  };
  const due = (o) =>
    Math.max(
      0,
      (o.status === "cancelled" ? o.shipped_cents : o.total_cents) -
        o.returned_cents -
        o.paid_cents +
        o.refunded_cents,
    );

  add("GET", "/payments", ({ user, query }) => {
    requireRole(
      user,
      "owner",
      "accountant",
      "seller",
      "manager",
      "rep",
      "courier",
    );
    return all("SELECT * FROM payments ORDER BY created_at DESC")
      .filter(
        (p) =>
          visible(user, p.entity_id) &&
          (!query.entity_id || p.entity_id === query.entity_id) &&
          (finance(user) || p.collected_by === user.id),
      )
      .map((p) => ({
        ...p,
        allocations: all(
          "SELECT order_id,amount_cents FROM payment_allocations WHERE payment_id=?",
          p.id,
        ),
        opening_allocated_cents: one(
          "SELECT COALESCE(SUM(amount_cents),0) n FROM opening_allocations WHERE payment_id=?",
          p.id,
        ).n,
        confirmation: "manual",
        fiscal_status: "not_fiscalized",
      }));
  });
  add("POST", "/payments", ({ user, body: b }) =>
    tx(() => {
      requireRole(
        user,
        "owner",
        "accountant",
        "seller",
        "manager",
        "rep",
        "courier",
      );
      entity(user, b.entity_id);
      integer(b.amount_cents, "сумма");
      if (!["cash", "bank"].includes(b.method))
        fail("Способ оплаты: cash или bank");
      if (b.method === "bank") requireRole(user, "owner", "accountant");
      if (b.collected_by && b.collected_by !== user.id)
        fail("Прием денег фиксирует сам сотрудник", 403);
      if (
        b.method === "cash" &&
        has(user, "manager") &&
        !has(user, "owner", "accountant", "seller", "rep", "courier")
      )
        fail("Нет права приема наличных", 403);
      const reference = text(
        b.reference,
        "основание платежа",
        b.method === "bank",
      );
      let allocations =
        b.allocations ??
        (b.order_id
          ? [{ order_id: b.order_id, amount_cents: b.amount_cents }]
          : []);
      if (!Array.isArray(allocations) || allocations.length > 100)
        fail("Некорректные распределения");
      if (!finance(user) && allocations.length === 0) fail("Выберите заказ");
      const seen = new Set();
      let used = 0;
      let client = b.client_id || null;
      const checked = [];
      for (const a of allocations) {
        integer(a.amount_cents, "распределение");
        if (seen.has(a.order_id)) fail("Заказ указан дважды");
        seen.add(a.order_id);
        const o = getOrder(user, a.order_id);
        if (o.entity_id !== b.entity_id) fail("Другая организация");
        if (
          o.status === "draft" ||
          (o.status === "cancelled" && o.shipped_cents <= o.returned_cents)
        )
          fail("Заказ не допускает оплату");
        if (client && o.client_id !== client) fail("Другой клиент");
        if (!client) client = o.client_id;
        if (checked.length && o.client_id !== checked[0].order.client_id)
          fail("Разные клиенты");
        const amount = Math.min(a.amount_cents, due(o));
        used += amount;
        if (used > b.amount_cents) fail("Распределение превышает платеж");
        checked.push({ order: o, amount });
      }
      if (client && !one("SELECT id FROM clients WHERE id=?", client))
        fail("Клиент не найден");
      const pid = id();
      run(
        "INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?)",
        pid,
        b.entity_id,
        client,
        b.amount_cents,
        b.method,
        user.id,
        reference,
        text(b.note, "примечание"),
        now(),
        Number(b.method === "cash" && has(user, "rep", "courier")),
      );
      for (const { order: o, amount } of checked) {
        if (!amount) continue;
        run(
          "INSERT INTO payment_allocations VALUES(?,?,?,?)",
          id(),
          pid,
          o.id,
          amount,
        );
        run(
          "UPDATE orders SET paid_cents=paid_cents+?,updated_at=?,version=version+1 WHERE id=?",
          amount,
          now(),
          o.id,
        );
      }
      audit(user, "payment.create", "payment", pid, {
        amount_cents: b.amount_cents,
        allocated_cents: used,
        method: b.method,
        manual: true,
      });
      return {
        ...one("SELECT * FROM payments WHERE id=?", pid),
        allocated_cents: used,
        unallocated_cents: b.amount_cents - used,
        fiscal_status: "not_fiscalized",
      };
    }),
  );
  add("POST", "/payments/:id/allocate", ({ user, body: b, params }) =>
    tx(() => {
      requireRole(user, "owner", "accountant");
      const payment = one("SELECT * FROM payments WHERE id=?", params.id);
      if (!payment) fail("Платеж не найден", 404);
      scope(user, payment.entity_id);
      if (
        !Array.isArray(b.allocations) ||
        !b.allocations.length ||
        b.allocations.length > 100
      )
        fail("Нужны распределения платежа");
      const existing = all(
        "SELECT a.*,o.client_id FROM payment_allocations a JOIN orders o ON o.id=a.order_id WHERE a.payment_id=?",
        payment.id,
      );
      const used =
          existing.reduce((s, a) => s + a.amount_cents, 0) +
          one(
            "SELECT COALESCE(SUM(amount_cents),0) n FROM opening_allocations WHERE payment_id=?",
            payment.id,
          ).n,
        remaining = payment.amount_cents - used;
      let client = payment.client_id,
        clientFixed = client !== null || existing.length > 0;
      if (existing.length) {
        if (client === null) client = existing[0].client_id;
        if (existing.some((a) => a.client_id !== client))
          fail("Расхождение клиентов исходного распределения", 409);
      }
      let amount = 0;
      const seen = new Set(),
        checked = [];
      for (const a of b.allocations) {
        integer(a.amount_cents, "сумма распределения");
        if (seen.has(a.order_id)) fail("Заказ указан дважды");
        seen.add(a.order_id);
        const order = getOrder(user, a.order_id);
        if (order.entity_id !== payment.entity_id) fail("Другая организация");
        if (
          order.status === "draft" ||
          (order.status === "cancelled" &&
            order.shipped_cents <= order.returned_cents)
        )
          fail("Заказ не допускает оплату");
        if (clientFixed && order.client_id !== client) fail("Другой клиент");
        if (!clientFixed) {
          client = order.client_id;
          clientFixed = true;
        }
        amount += a.amount_cents;
        if (!Number.isSafeInteger(amount) || amount > remaining)
          fail("Распределение превышает нераспределенный остаток");
        if (a.amount_cents > due(order))
          fail("Распределение превышает неоплаченную сумму заказа");
        checked.push({ order, amount: a.amount_cents });
      }
      for (const item of checked) {
        const previous = existing.find((a) => a.order_id === item.order.id);
        if (previous)
          run(
            "UPDATE payment_allocations SET amount_cents=amount_cents+? WHERE id=?",
            item.amount,
            previous.id,
          );
        else
          run(
            "INSERT INTO payment_allocations VALUES(?,?,?,?)",
            id(),
            payment.id,
            item.order.id,
            item.amount,
          );
        run(
          "UPDATE orders SET paid_cents=paid_cents+?,updated_at=?,version=version+1 WHERE id=?",
          item.amount,
          now(),
          item.order.id,
        );
      }
      if (payment.client_id === null && client !== null)
        run("UPDATE payments SET client_id=? WHERE id=?", client, payment.id);
      audit(user, "payment.allocate", "payment", payment.id, {
        entity_id: payment.entity_id,
        allocations: b.allocations,
        allocated_cents: amount,
      });
      return {
        ...one("SELECT * FROM payments WHERE id=?", payment.id),
        allocations: all(
          "SELECT order_id,amount_cents FROM payment_allocations WHERE payment_id=?",
          payment.id,
        ),
        allocated_cents: used + amount,
        unallocated_cents: remaining - amount,
      };
    }),
  );
  add("POST", "/refunds", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "owner", "accountant");
      const o = getOrder(user, b.order_id);
      integer(b.amount_cents, "сумма");
      if (!["cash", "bank"].includes(b.method))
        fail("Некорректный способ возврата");
      const reason = text(b.reason, "причина", true);
      const permitted = Math.min(
        o.paid_cents - o.refunded_cents,
        (o.status === "cancelled"
          ? o.total_cents - o.shipped_cents + o.returned_cents
          : o.returned_cents) - o.refunded_cents,
      );
      if (b.amount_cents > permitted)
        fail(
          "Возврат превышает подтвержденные возвраты товара или полученную оплату",
        );
      const rid = id();
      run(
        "INSERT INTO refunds VALUES(?,?,?,?,?,?,?,?)",
        rid,
        o.entity_id,
        o.id,
        b.amount_cents,
        b.method,
        reason,
        user.id,
        now(),
      );
      run(
        "UPDATE orders SET refunded_cents=refunded_cents+?,updated_at=?,version=version+1 WHERE id=?",
        b.amount_cents,
        now(),
        o.id,
      );
      audit(user, "refund.create", "refund", rid, {
        order_id: o.id,
        amount_cents: b.amount_cents,
      });
      return one("SELECT * FROM refunds WHERE id=?", rid);
    }),
  );
  add("GET", "/cash", ({ user }) => {
    requireRole(user, "owner", "accountant", "rep", "courier", "seller");
    const balances = [];
    for (const u of all("SELECT id,name,roles FROM users")) {
      if (
        !JSON.parse(u.roles).some((r) => ["rep", "courier"].includes(r)) &&
        !one(
          "SELECT id FROM payments WHERE collected_by=? AND held_in_custody=1",
          u.id,
        )
      )
        continue;
      if (!finance(user) && u.id !== user.id) continue;
      for (const e of all("SELECT id FROM entities"))
        if (visible(user, e.id))
          balances.push({
            user_id: u.id,
            name: u.name,
            entity_id: e.id,
            amount_cents: custody(u.id, e.id),
          });
    }
    return {
      balances,
      handovers: all(
        "SELECT * FROM cash_handovers ORDER BY created_at DESC",
      ).filter(
        (h) =>
          visible(user, h.entity_id) &&
          (finance(user) || has(user, "seller") || h.user_id === user.id),
      ),
    };
  });
  add("POST", "/cash/handovers", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "rep", "courier");
      entity(user, b.entity_id);
      integer(b.amount_cents, "сумма");
      const pending = one(
        `SELECT COALESCE(SUM(amount_cents),0) n FROM cash_handovers WHERE entity_id=? AND user_id=? AND status='pending'`,
        b.entity_id,
        user.id,
      ).n;
      if (b.amount_cents > custody(user.id, b.entity_id) - pending)
        fail("Недостаточно несданных наличных");
      const hid = id();
      run(
        "INSERT INTO cash_handovers VALUES(?,?,?,?,?,?,?,?,?)",
        hid,
        b.entity_id,
        user.id,
        b.amount_cents,
        "pending",
        text(b.note, "примечание"),
        null,
        now(),
        null,
      );
      audit(user, "cash.request", "handover", hid, {
        amount_cents: b.amount_cents,
      });
      return one("SELECT * FROM cash_handovers WHERE id=?", hid);
    }),
  );
  add("POST", "/cash/handovers/:id/confirm", ({ user, params }) =>
    tx(() => {
      requireRole(user, "owner", "accountant", "seller");
      const h = one("SELECT * FROM cash_handovers WHERE id=?", params.id);
      if (!h) fail("Передача не найдена", 404);
      scope(user, h.entity_id);
      if (h.user_id === user.id)
        fail("Подтверждает другой сотрудник-получатель", 403);
      if (h.status !== "pending") fail("Передача уже подтверждена", 409);
      if (h.amount_cents > custody(h.user_id, h.entity_id))
        fail("Расхождение остатка наличных", 409);
      run(
        "UPDATE cash_handovers SET status='confirmed',confirmed_by=?,confirmed_at=? WHERE id=?",
        user.id,
        now(),
        h.id,
      );
      audit(user, "cash.confirm", "handover", h.id, {
        from: h.user_id,
        amount_cents: h.amount_cents,
      });
      return one("SELECT * FROM cash_handovers WHERE id=?", h.id);
    }),
  );
  add("GET", "/expenses", ({ user, query }) => {
    requireRole(user, "owner", "accountant");
    return all("SELECT * FROM expenses ORDER BY date DESC").filter(
      (e) =>
        visible(user, e.entity_id) &&
        (!query.entity_id || query.entity_id === e.entity_id),
    );
  });
  add("POST", "/expenses", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "owner", "accountant");
      entity(user, b.entity_id);
      integer(b.amount_cents, "сумма");
      const eid = id();
      run(
        "INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?)",
        eid,
        b.entity_id,
        b.amount_cents,
        text(b.category, "категория", true),
        text(b.note, "примечание"),
        date(b.date, "дата"),
        user.id,
        now(),
      );
      audit(user, "expense.create", "expense", eid, {
        entity_id: b.entity_id,
        amount_cents: b.amount_cents,
      });
      return one("SELECT * FROM expenses WHERE id=?", eid);
    }),
  );

  add("GET", "/audit", ({ user }) => {
    requireRole(user, "owner", "accountant");
    return all("SELECT * FROM audit ORDER BY created_at DESC LIMIT 500")
      .filter((a) => {
        if (has(user, "owner")) return true;
        const p = JSON.parse(a.payload || "{}");
        return p.entity_id
          ? visible(user, p.entity_id)
          : a.actor_id === user.id;
      })
      .map((a) => ({ ...a, payload: JSON.parse(a.payload || "{}") }));
  });

  const deliveryOrder = (u, d) => {
    const o = one("SELECT * FROM orders WHERE id=?", d.order_id);
    scope(u, o.entity_id, o.warehouse_id);
    if (
      has(u, "courier") &&
      !has(u, "owner", "dispatcher") &&
      d.courier_id !== u.id
    )
      fail("Чужая доставка", 403);
    return o;
  };
  const checkCourier = (uid, o) => {
    if (!uid) return null;
    const u = one("SELECT * FROM users WHERE id=? AND active=1", uid);
    if (
      !u ||
      !JSON.parse(u.roles).includes("courier") ||
      !JSON.parse(u.entity_ids).includes(o.entity_id) ||
      !JSON.parse(u.warehouse_ids).includes(o.warehouse_id)
    )
      fail("Курьер недоступен для этого склада/организации");
    return uid;
  };
  add("GET", "/deliveries", ({ user }) => {
    requireRole(user, "owner", "dispatcher", "courier");
    return all(
      "SELECT d.*,o.number order_number,o.entity_id,o.warehouse_id,MAX(0,o.total_cents-o.returned_cents-o.paid_cents+o.refunded_cents) amount_due_cents FROM deliveries d JOIN orders o ON o.id=d.order_id ORDER BY d.created_at DESC",
    ).filter(
      (d) =>
        visible(user, d.entity_id, d.warehouse_id) &&
        (!has(user, "courier") ||
          has(user, "owner", "dispatcher") ||
          d.courier_id === user.id),
    );
  });
  add("POST", "/deliveries", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "owner", "dispatcher");
      const o = one("SELECT * FROM orders WHERE id=?", b.order_id);
      if (!o) fail("Заказ не найден", 404);
      scope(user, o.entity_id, o.warehouse_id);
      if (
        o.fulfillment !== "delivery" ||
        ["draft", "cancelled"].includes(o.status)
      )
        fail("Заказ не готов к доставке");
      if (one("SELECT id FROM deliveries WHERE order_id=?", o.id))
        fail("Доставка уже существует", 409);
      const courier = checkCourier(b.courier_id, o),
        did = id();
      if (
        b.collect_on_delivery !== undefined &&
        typeof b.collect_on_delivery !== "boolean"
      )
        fail("Укажите признак оплаты при вручении");
      run(
        "INSERT INTO deliveries(id,order_id,courier_id,address,phone,interval,note,places,status,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        did,
        o.id,
        courier,
        text(b.address || o.address, "адрес", true),
        text(b.phone, "телефон"),
        text(b.interval, "интервал"),
        text(b.note, "примечание"),
        integer(b.places ?? 1, "места"),
        courier ? "assigned" : "awaiting",
        null,
        now(),
        now(),
      );
      run(
        "UPDATE deliveries SET collect_on_delivery=? WHERE id=?",
        Number(!!b.collect_on_delivery),
        did,
      );
      audit(user, "delivery.create", "delivery", did, {
        entity_id: o.entity_id,
        order_id: o.id,
      });
      return one("SELECT * FROM deliveries WHERE id=?", did);
    }),
  );
  add("PATCH", "/deliveries/:id", ({ user, body: b, params }) =>
    tx(() => {
      requireRole(user, "owner", "dispatcher", "courier");
      const d = one("SELECT * FROM deliveries WHERE id=?", params.id);
      if (!d) fail("Доставка не найдена", 404);
      const o = deliveryOrder(user, d);
      const dispatcher = has(user, "owner", "dispatcher");
      if (
        !dispatcher &&
        Object.keys(b).some((k) => !["status", "note", "reason"].includes(k))
      )
        fail("Нельзя изменять назначение", 403);
      let courier = d.courier_id,
        status = d.status;
      if (b.courier_id !== undefined) {
        if (!dispatcher) fail("Нет прав", 403);
        if (["delivered", "in_transit"].includes(d.status))
          fail("Нельзя переназначить текущую доставку");
        courier = checkCourier(b.courier_id, o);
        status = courier ? "assigned" : "awaiting";
      }
      if (b.status !== undefined) {
        const transitions = {
          awaiting: ["assigned"],
          assigned: ["in_transit"],
          in_transit: ["delivered", "failed"],
          failed: ["assigned"],
          delivered: [],
        };
        if (!transitions[d.status]?.includes(b.status))
          fail("Недопустимый переход доставки", 409);
        if (!courier) fail("Назначьте курьера");
        if (b.status === "in_transit" && o.shipped_cents <= 0)
          fail("Заказ еще не отгружен");
        if (b.status === "failed") text(b.reason, "причина", true);
        status = b.status;
      }
      run(
        "UPDATE deliveries SET courier_id=?,status=?,note=?,reason=?,updated_at=? WHERE id=?",
        courier,
        status,
        b.note === undefined ? d.note : text(b.note, "примечание"),
        b.reason === undefined ? d.reason : text(b.reason, "причина"),
        now(),
        d.id,
      );
      if (status === "delivered")
        run(
          "INSERT INTO delivery_details(delivery_id,delivered_at) VALUES(?,?) ON CONFLICT(delivery_id) DO UPDATE SET delivered_at=excluded.delivered_at",
          d.id,
          now(),
        );
      audit(user, "delivery.update", "delivery", d.id, {
        entity_id: o.entity_id,
        status,
      });
      return one("SELECT * FROM deliveries WHERE id=?", d.id);
    }),
  );
  add("GET", "/visits", ({ user }) => {
    requireRole(user, "owner", "rep");
    return all(
      "SELECT v.*,c.name client_name FROM visits v JOIN clients c ON c.id=v.client_id ORDER BY scheduled_at",
    ).filter((v) => has(user, "owner") || v.user_id === user.id);
  });
  add("POST", "/visits", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "owner", "rep");
      clientAccess(user, b.client_id);
      const vid = id();
      run(
        "INSERT INTO visits VALUES(?,?,?,?,?,?,?,?,?,?)",
        vid,
        b.client_id,
        user.id,
        date(b.scheduled_at, "дата визита"),
        text(b.note, "примечание"),
        "planned",
        null,
        null,
        null,
        now(),
      );
      audit(user, "visit.create", "visit", vid, {});
      return one("SELECT * FROM visits WHERE id=?", vid);
    }),
  );
  add("PATCH", "/visits/:id", ({ user, body: b, params }) =>
    tx(() => {
      requireRole(user, "owner", "rep");
      const v = one("SELECT * FROM visits WHERE id=?", params.id);
      if (!v) fail("Визит не найден", 404);
      if (!has(user, "owner") && v.user_id !== user.id)
        fail("Чужой визит", 403);
      if (!["planned", "completed", "cancelled"].includes(b.status))
        fail("Некорректный статус");
      if (v.status !== "planned") fail("Визит уже завершен", 409);
      const result = text(b.result, "результат", b.status === "completed"),
        reason = text(b.reason, "причина", b.status === "cancelled");
      run(
        "UPDATE visits SET status=?,result=?,reason=?,next_date=? WHERE id=?",
        b.status,
        result,
        reason,
        b.next_date ? date(b.next_date, "следующая дата") : null,
        v.id,
      );
      audit(user, "visit.update", "visit", v.id, { status: b.status });
      return one("SELECT * FROM visits WHERE id=?", v.id);
    }),
  );

  add("GET", "/purchases", ({ user }) => {
    requireRole(user, "owner", "accountant", "warehouse");
    return all("SELECT * FROM purchases ORDER BY created_at DESC")
      .filter((p) => visible(user, p.entity_id, p.warehouse_id))
      .map((p) => ({
        ...p,
        lines: all(
          "SELECT * FROM purchase_lines WHERE purchase_id=?",
          p.id,
        ).map((l) =>
          finance(user) ? l : (({ cost_cents, ...rest }) => rest)(l),
        ),
      }));
  });
  add("POST", "/purchases", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "owner", "accountant");
      entity(user, b.entity_id);
      scope(user, b.entity_id, b.warehouse_id);
      if (!one("SELECT id FROM warehouses WHERE id=?", b.warehouse_id))
        fail("Склад не найден");
      if (
        b.supplier_id &&
        !one(
          "SELECT id FROM clients WHERE id=? AND kind='supplier'",
          b.supplier_id,
        )
      )
        fail("Поставщик не найден");
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 1000)
        fail("Нужны позиции закупки");
      const pid = id();
      run(
        "INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?,?)",
        pid,
        b.entity_id,
        b.warehouse_id,
        b.supplier_id || null,
        b.expected_at ? date(b.expected_at, "ожидаемая дата") : null,
        text(b.notes, "примечание"),
        "ordered",
        user.id,
        now(),
        null,
      );
      for (const l of b.lines) {
        if (
          !one("SELECT id FROM products WHERE id=? AND active=1", l.product_id)
        )
          fail("Товар не найден");
        integer(l.qty, "количество");
        integer(l.cost_cents, "себестоимость", 0);
        run(
          "INSERT INTO purchase_lines VALUES(?,?,?,?,?,?,?)",
          id(),
          pid,
          l.product_id,
          l.qty,
          l.cost_cents,
          text(l.batch_number, "партия"),
          l.expires_at ? date(l.expires_at, "годность") : null,
        );
      }
      audit(user, "purchase.create", "purchase", pid, {
        entity_id: b.entity_id,
      });
      return one("SELECT * FROM purchases WHERE id=?", pid);
    }),
  );
  add("POST", "/purchases/:id/receive", ({ user, params }) =>
    tx(() => {
      requireRole(user, "owner", "accountant", "warehouse");
      const p = one("SELECT * FROM purchases WHERE id=?", params.id);
      if (!p) fail("Закупка не найдена", 404);
      scope(user, p.entity_id, p.warehouse_id);
      if (p.status === "received") fail("Закупка уже принята", 409);
      for (const l of all(
        "SELECT * FROM purchase_lines WHERE purchase_id=?",
        p.id,
      ))
        ctx.stockReceive(user, {
          entity_id: p.entity_id,
          warehouse_id: p.warehouse_id,
          product_id: l.product_id,
          qty: l.qty,
          cost_cents: l.cost_cents,
          supplier_id: p.supplier_id,
          batch_number: l.batch_number,
          expires_at: l.expires_at,
          reason: `Закупка ${p.id}`,
        });
      run(
        "UPDATE purchases SET status='received',received_at=? WHERE id=?",
        now(),
        p.id,
      );
      audit(user, "purchase.receive", "purchase", p.id, {
        entity_id: p.entity_id,
      });
      return one("SELECT * FROM purchases WHERE id=?", p.id);
    }),
  );
  add("GET", "/promotions", ({ user }) => {
    requireRole(user, "owner", "accountant", "seller", "manager", "rep");
    return all("SELECT * FROM promotions ORDER BY starts_at DESC").map((p) => ({
      ...p,
      product_ids: JSON.parse(p.product_ids),
    }));
  });
  add("POST", "/promotions", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "owner");
      const start = date(b.starts_at, "начало"),
        end = date(b.ends_at, "конец");
      if (Date.parse(end) <= Date.parse(start))
        fail("Конец должен быть позже начала");
      if (
        typeof b.discount_percent !== "number" ||
        !Number.isFinite(b.discount_percent) ||
        b.discount_percent <= 0 ||
        b.discount_percent > 100
      )
        fail("Некорректная скидка");
      if (
        !Array.isArray(b.product_ids) ||
        !b.product_ids.length ||
        new Set(b.product_ids).size !== b.product_ids.length
      )
        fail("Выберите товары");
      for (const p of b.product_ids)
        if (!one("SELECT id FROM products WHERE id=?", p))
          fail("Товар не найден");
      const pid = id();
      run(
        "INSERT INTO promotions VALUES(?,?,?,?,?,?,?,?)",
        pid,
        text(b.name, "название", true),
        new Date(start).toISOString(),
        new Date(end).toISOString(),
        b.discount_percent,
        JSON.stringify(b.product_ids),
        now(),
        user.id,
      );
      audit(user, "promotion.create", "promotion", pid, {});
      return {
        ...one("SELECT * FROM promotions WHERE id=?", pid),
        product_ids: b.product_ids,
      };
    }),
  );

  add("GET", "/reports/overview", ({ user, query: q }) => {
    requireRole(user, "owner", "accountant");
    entity(user, q.entity_id);
    const boundary = (v, label) =>
      new Date(
        date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00+04:00" : v, label),
      ).toISOString();
    const from = q.from ? boundary(q.from, "начало") : "0000",
      to = q.to ? boundary(q.to, "конец") : "9999";
    if (from >= to) fail("Некорректный период");
    const orders = all("SELECT * FROM orders WHERE entity_id=?", q.entity_id);
    const sum = (rows, key) =>
      rows.reduce((s, r) => s + Number(r[key] || 0), 0);
    const movements = all(
      "SELECT * FROM stock_movements WHERE entity_id=? AND created_at>=? AND created_at<?",
      q.entity_id,
      from,
      to,
    );
    const receipts = all(
        "SELECT * FROM payments WHERE entity_id=? AND created_at>=? AND created_at<?",
        q.entity_id,
        from,
        to,
      ),
      expenses = all(
        "SELECT * FROM expenses WHERE entity_id=? AND date>=? AND date<?",
        q.entity_id,
        q.from?.slice(0, 10) || "0000",
        q.to?.slice(0, 10) || "9999",
      );
    const commercial = movements.filter((m) =>
        ["ship", "return"].includes(m.kind),
      ),
      unknownRevenue = commercial.some((m) => m.revenue_cents == null),
      unknownCost = commercial.some((m) => m.cost_cents == null);
    const sales = unknownRevenue ? null : sum(commercial, "revenue_cents"),
      cost = unknownCost
        ? null
        : commercial.reduce((s, m) => s - m.qty * m.cost_cents, 0);
    const inv = all(
        "SELECT * FROM stock_batches WHERE entity_id=? AND qty+quarantine>0",
        q.entity_id,
      ),
      inventory = inv.some((b) => b.cost_cents == null)
        ? null
        : inv.reduce((s, b) => s + (b.qty + b.quarantine) * b.cost_cents, 0);
    const writeoffs = movements.filter(
        (m) =>
          ["adjust", "writeoff", "stocktake"].includes(m.kind) && m.qty < 0,
      ),
      writeoffCost = writeoffs.some((m) => m.cost_cents == null)
        ? null
        : writeoffs.reduce((s, m) => s - m.qty * m.cost_cents, 0);
    const grouped = new Map();
    for (const m of commercial) {
      if (!grouped.has(m.product_id)) {
        const p = one("SELECT name,sku FROM products WHERE id=?", m.product_id);
        grouped.set(m.product_id, {
          product_id: m.product_id,
          ...p,
          qty: 0,
          sales_cents: 0,
          cost_cents: 0,
          movement_ids: [],
        });
      }
      const p = grouped.get(m.product_id);
      p.qty -= m.qty;
      p.sales_cents =
        p.sales_cents == null || m.revenue_cents == null
          ? null
          : p.sales_cents + m.revenue_cents;
      p.cost_cents =
        p.cost_cents == null || m.cost_cents == null
          ? null
          : p.cost_cents - m.qty * m.cost_cents;
      p.movement_ids.push(m.id);
    }
    const products = [...grouped.values()].map((p) => ({
      ...p,
      gross_profit_cents:
        p.sales_cents == null || p.cost_cents == null
          ? null
          : p.sales_cents - p.cost_cents,
    }));
    const ids = new Set(commercial.map((m) => m.order_id));
    const rows = orders.filter((o) => ids.has(o.id));
    return {
      entity_id: q.entity_id,
      opening_debt_cents: all(
        "SELECT * FROM opening_debts WHERE entity_id=?",
        q.entity_id,
      ).reduce(
        (sum, d) =>
          sum +
          d.amount_cents -
          one(
            "SELECT COALESCE(SUM(amount_cents),0) n FROM opening_allocations WHERE debt_id=?",
            d.id,
          ).n,
        0,
      ),
      supplier_balance_cents: all(
        "SELECT SUM(amount_cents) n FROM supplier_ledger WHERE entity_id=? GROUP BY supplier_id",
        q.entity_id,
      ).reduce((sum, r) => sum + Math.max(0, r.n), 0),
      supplier_advances_cents: all(
        "SELECT SUM(amount_cents) n FROM supplier_ledger WHERE entity_id=? GROUP BY supplier_id",
        q.entity_id,
      ).reduce((sum, r) => sum + Math.max(0, -r.n), 0),
      sales_cents: sales,
      cost_cents: cost,
      gross_profit_cents: sales == null || cost == null ? null : sales - cost,
      receipts_cents: sum(receipts, "amount_cents"),
      debt_cents:
        orders
          .filter((o) => o.status !== "draft")
          .reduce(
            (s, o) =>
              s +
              Math.max(
                0,
                o.shipped_cents -
                  o.returned_cents -
                  o.paid_cents +
                  o.refunded_cents,
              ),
            0,
          ) +
        all(
          "SELECT * FROM opening_debts WHERE entity_id=?",
          q.entity_id,
        ).reduce(
          (sum, d) =>
            sum +
            d.amount_cents -
            one(
              "SELECT COALESCE(SUM(amount_cents),0) n FROM opening_allocations WHERE debt_id=?",
              d.id,
            ).n,
          0,
        ),
      overdue_cents:
        orders
          .filter(
            (o) =>
              o.due_date &&
              o.due_date < now().slice(0, 10) &&
              o.status !== "draft",
          )
          .reduce(
            (s, o) =>
              s +
              Math.max(
                0,
                o.shipped_cents -
                  o.returned_cents -
                  o.paid_cents +
                  o.refunded_cents,
              ),
            0,
          ) +
        all(
          "SELECT * FROM opening_debts WHERE entity_id=? AND due_date<?",
          q.entity_id,
          new Date(Date.parse(now()) + 4 * 3600000).toISOString().slice(0, 10),
        ).reduce(
          (sum, d) =>
            sum +
            d.amount_cents -
            one(
              "SELECT COALESCE(SUM(amount_cents),0) n FROM opening_allocations WHERE debt_id=?",
              d.id,
            ).n,
          0,
        ),
      inventory_cents: inventory,
      expenses_cents: sum(expenses, "amount_cents"),
      returns_cents: commercial
        .filter((m) => m.kind === "return")
        .some((m) => m.revenue_cents == null)
        ? null
        : -sum(
            commercial.filter((m) => m.kind === "return"),
            "revenue_cents",
          ),
      writeoffs_cents: writeoffCost,
      cash_custody_cents: all("SELECT id FROM users").reduce(
        (s, u) => s + custody(u.id, q.entity_id),
        0,
      ),
      has_data: orders.length > 0 || inv.length > 0 || receipts.length > 0,
      products,
      documents: rows.map((o) => ctx.orderView(user, o.id)),
      receipt_documents: receipts,
      debt_documents: orders
        .map((o) => ({
          ...o,
          debt_cents: Math.max(
            0,
            o.shipped_cents -
              o.returned_cents -
              o.paid_cents +
              o.refunded_cents,
          ),
        }))
        .filter((o) => o.status !== "draft" && o.debt_cents > 0)
        .concat(
          all(
            "SELECT d.*,c.name client_name FROM opening_debts d JOIN clients c ON c.id=d.client_id WHERE d.entity_id=?",
            q.entity_id,
          )
            .map((d) => ({
              ...d,
              number: "Начальный долг: " + d.client_name,
              debt_cents:
                d.amount_cents -
                one(
                  "SELECT COALESCE(SUM(amount_cents),0) n FROM opening_allocations WHERE debt_id=?",
                  d.id,
                ).n,
            }))
            .filter((d) => d.debt_cents > 0),
        ),
      movements: commercial,
      time_zone: "Europe/Astrakhan",
      cost_status: unknownCost ? "incomplete" : "recorded_purchase_cost",
      period_basis: "movement_created_at",
      balance_as_of: now(),
      tax_basis: "as_recorded_policy_pending",
      note: "Продажи по дате отгрузки/возврата. Долги, остатки и наличные на текущий момент. Закупочная стоимость без нераспределенных затрат; НДС требует учетной политики. Касса и 1С не подключены",
    };
  });
}
