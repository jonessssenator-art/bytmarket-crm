import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "../server/db.mjs";
import { initExtensions, registerExtensions } from "../server/extensions.mjs";
import { installCore, registerCore } from "../server/core.mjs";

function fixture() {
  const db = createDb(":memory:");
  initExtensions(db);
  const routes = new Map();
  const timestamp = "2026-11-05T10:00:00.000Z";
  db.prepare("INSERT INTO entities VALUES(?,?,?,?)").run(
    "e",
    "ООО",
    "ooo",
    "{}",
  );
  db.prepare("INSERT INTO entities VALUES(?,?,?,?)").run(
    "other",
    "ИП",
    "ip",
    "{}",
  );
  db.prepare("INSERT INTO warehouses VALUES(?,?)").run("w", "Склад");
  const makeUser = (uid, roles) => {
    const u = { id: uid, roles, entity_ids: ["e"], warehouse_ids: ["w"] };
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)").run(
      uid,
      uid,
      `${uid}@test.local`,
      "unused",
      JSON.stringify(roles),
      '["e"]',
      '["w"]',
      1,
      timestamp,
    );
    return u;
  };
  const owner = makeUser("owner", ["owner"]),
    rep = makeUser("rep", ["rep"]),
    courier = makeUser("courier", ["courier"]),
    another = makeUser("another", ["courier"]),
    seller = makeUser("seller", ["seller"]);
  db.prepare(
    "INSERT INTO clients(id,name,assigned_to,created_at) VALUES(?,?,?,?)",
  ).run("c", "Клиент", rep.id, timestamp);
  db.prepare(
    "INSERT INTO products(id,sku,name,pack_size,retail_cents,wholesale_cents,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run("p", "SKU", "Товар", 1, 100, 100, timestamp);
  const order = (oid, entity = "e") =>
    db
      .prepare(
        "INSERT INTO orders(id,number,entity_id,warehouse_id,client_id,channel,status,total_cents,fulfillment,address,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        oid,
        oid,
        entity,
        "w",
        "c",
        "wholesale",
        "confirmed",
        1000,
        "delivery",
        "Адрес",
        rep.id,
        timestamp,
        timestamp,
      );
  order("o");
  order("x", "other");
  const err = (status, message) =>
    Object.assign(new Error(message), { status });
  const ctx = {
    db,
    id: randomUUID,
    now: () => timestamp,
    error: err,
    requireRole: (u, ...roles) => {
      if (!u.roles.some((r) => roles.includes(r))) throw err(403, "Нет прав");
    },
    scope: (u, e, w) => {
      if (
        !u.roles.includes("owner") &&
        (!u.entity_ids.includes(e) || (w && !u.warehouse_ids.includes(w)))
      )
        throw err(403, "Нет доступа");
    },
    canOrder: (u, o) =>
      u.roles.includes("owner") ||
      !u.roles.includes("courier") ||
      !!db
        .prepare("SELECT id FROM deliveries WHERE order_id=? AND courier_id=?")
        .get(o.id, u.id),
    audit: (u, a, t, i, p) =>
      db
        .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
        .run(randomUUID(), u.id, a, t, i, JSON.stringify(p), timestamp),
    orderView: (_, oid) =>
      db.prepare("SELECT * FROM orders WHERE id=?").get(oid),
  };
  ctx.tx = (fn) => {
    if (db.isTransaction) return fn();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  ctx.stockReceive = () => {
    throw new Error("Not exercised by this fixture");
  };
  registerExtensions((m, p, h) => routes.set(`${m} ${p}`, h), ctx);
  const call = (m, p, u = owner, body = {}, params = {}, query = {}) =>
    routes.get(`${m} ${p}`)({ user: u, body, params, query });
  return { db, call, owner, rep, courier, another, seller, order };
}

test("partial allocations, excess unallocated, atomic rejection and limited refund", () => {
  const f = fixture();
  try {
    const first = f.call("POST", "/payments", f.rep, {
      entity_id: "e",
      order_id: "o",
      amount_cents: 400,
      method: "cash",
    });
    assert.equal(first.allocated_cents, 400);
    const second = f.call("POST", "/payments", f.rep, {
      entity_id: "e",
      order_id: "o",
      amount_cents: 800,
      method: "cash",
    });
    assert.equal(second.allocated_cents, 600);
    assert.equal(second.unallocated_cents, 200);
    assert.equal(
      f.db.prepare("SELECT paid_cents FROM orders WHERE id=?").get("o")
        .paid_cents,
      1000,
    );
    assert.throws(
      () =>
        f.call("POST", "/payments", f.owner, {
          entity_id: "e",
          order_id: "x",
          amount_cents: 100,
          method: "cash",
        }),
      /Другая организация/,
    );
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM payments").get().n, 2);
    assert.throws(
      () =>
        f.call("POST", "/payments", f.rep, {
          entity_id: "e",
          order_id: "o",
          amount_cents: 1,
          method: "bank",
          reference: "Скриншот",
        }),
      /Нет прав/,
    );
    assert.throws(
      () =>
        f.call("POST", "/refunds", f.owner, {
          order_id: "o",
          amount_cents: 100,
          method: "cash",
          reason: "Возврат",
        }),
      /превышает/,
    );
    f.db.prepare("UPDATE orders SET returned_cents=300 WHERE id=?").run("o");
    f.call("POST", "/refunds", f.owner, {
      order_id: "o",
      amount_cents: 200,
      method: "cash",
      reason: "Возврат товара",
    });
    assert.throws(
      () =>
        f.call("POST", "/refunds", f.owner, {
          order_id: "o",
          amount_cents: 101,
          method: "cash",
          reason: "Повтор",
        }),
      /превышает/,
    );
    f.call("POST", "/refunds", f.owner, {
      order_id: "o",
      amount_cents: 100,
      method: "cash",
      reason: "Остаток",
    });
    assert.equal(
      f.db.prepare("SELECT refunded_cents FROM orders WHERE id=?").get("o")
        .refunded_cents,
      300,
    );
  } finally {
    f.db.close();
  }
});

test("later allocation consumes only remainder, stays scoped and rolls back a rejected batch", () => {
  const f = fixture();
  try {
    f.order("later");
    const payment = f.call("POST", "/payments", f.owner, {
      entity_id: "e",
      order_id: "o",
      amount_cents: 1300,
      method: "cash",
    });
    assert.equal(payment.unallocated_cents, 300);
    const allocate = (allocations, user = f.owner) =>
      f.call(
        "POST",
        "/payments/:id/allocate",
        user,
        { allocations },
        { id: payment.id },
      );
    assert.throws(
      () => allocate([{ order_id: "later", amount_cents: 100 }], f.rep),
      /Нет прав/,
    );
    assert.throws(
      () => allocate([{ order_id: "x", amount_cents: 100 }]),
      /Другая организация/,
    );
    assert.throws(
      () =>
        allocate([
          { order_id: "later", amount_cents: 100 },
          { order_id: "later", amount_cents: 100 },
        ]),
      /дважды/,
    );
    assert.equal(
      f.db.prepare("SELECT paid_cents FROM orders WHERE id=?").get("later")
        .paid_cents,
      0,
    );
    const first = allocate([{ order_id: "later", amount_cents: 100 }]);
    assert.equal(first.unallocated_cents, 200);
    f.order("third");
    assert.throws(
      () =>
        allocate([
          { order_id: "later", amount_cents: 100 },
          { order_id: "third", amount_cents: 101 },
        ]),
      /остаток/,
    );
    assert.equal(
      f.db.prepare("SELECT paid_cents FROM orders WHERE id=?").get("later")
        .paid_cents,
      100,
    );
    assert.equal(
      f.db.prepare("SELECT paid_cents FROM orders WHERE id=?").get("third")
        .paid_cents,
      0,
    );
    const last = allocate([{ order_id: "later", amount_cents: 200 }]);
    assert.equal(last.unallocated_cents, 0);
    assert.equal(last.amount_cents, 1300);
    assert.equal(
      last.allocations.filter((a) => a.order_id === "later").length,
      1,
    );
    assert.equal(
      last.allocations.find((a) => a.order_id === "later").amount_cents,
      300,
    );
    assert.throws(
      () => allocate([{ order_id: "later", amount_cents: 200 }]),
      /остаток/,
    );
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
    assert.equal(
      f.db.prepare("SELECT SUM(paid_cents) n FROM orders").get().n,
      1300,
    );
    const unidentified = f.call("POST", "/payments", f.owner, {
      entity_id: "e",
      amount_cents: 500,
      method: "bank",
      reference: "Выписка №1",
    });
    const bound = f.call(
      "POST",
      "/payments/:id/allocate",
      f.owner,
      { allocations: [{ order_id: "third", amount_cents: 200 }] },
      { id: unidentified.id },
    );
    assert.equal(bound.client_id, "c");
    f.order("anonymous");
    f.db
      .prepare("UPDATE orders SET client_id=NULL WHERE id=?")
      .run("anonymous");
    assert.throws(
      () =>
        f.call(
          "POST",
          "/payments/:id/allocate",
          f.owner,
          { allocations: [{ order_id: "anonymous", amount_cents: 100 }] },
          { id: unidentified.id },
        ),
      /Другой клиент/,
    );
    assert.throws(
      () =>
        f.call(
          "POST",
          "/payments/:id/allocate",
          f.owner,
          { allocations: [{ order_id: "o", amount_cents: 100 }] },
          { id: unidentified.id },
        ),
      /неоплаченную/,
    );
  } finally {
    f.db.close();
  }
});

test("cash handover reserves amount, requires a different recipient and never pays twice", () => {
  const f = fixture();
  try {
    f.call("POST", "/payments", f.rep, {
      entity_id: "e",
      order_id: "o",
      amount_cents: 500,
      method: "cash",
    });
    const h = f.call("POST", "/cash/handovers", f.rep, {
      entity_id: "e",
      amount_cents: 400,
    });
    assert.throws(
      () =>
        f.call("POST", "/cash/handovers", f.rep, {
          entity_id: "e",
          amount_cents: 101,
        }),
      /Недостаточно/,
    );
    assert.throws(
      () =>
        f.call(
          "POST",
          "/cash/handovers/:id/confirm",
          { ...f.rep, roles: ["rep", "seller"] },
          {},
          { id: h.id },
        ),
      /другой/,
    );
    f.call("POST", "/cash/handovers/:id/confirm", f.seller, {}, { id: h.id });
    assert.throws(
      () =>
        f.call(
          "POST",
          "/cash/handovers/:id/confirm",
          f.seller,
          {},
          { id: h.id },
        ),
      /уже/,
    );
    const cash = f.call("GET", "/cash", f.rep);
    assert.equal(
      cash.balances.find((b) => b.user_id === f.rep.id && b.entity_id === "e")
        .amount_cents,
      100,
    );
    assert.equal(
      f.db.prepare("SELECT paid_cents FROM orders WHERE id=?").get("o")
        .paid_cents,
      500,
    );
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
  } finally {
    f.db.close();
  }
});

test("courier scope and delivery transitions do not create payment", () => {
  const f = fixture();
  try {
    const d = f.call("POST", "/deliveries", f.owner, {
      order_id: "o",
      courier_id: f.courier.id,
      address: "Адрес",
    });
    assert.deepEqual(f.call("GET", "/deliveries", f.another), []);
    assert.throws(
      () =>
        f.call(
          "PATCH",
          "/deliveries/:id",
          f.another,
          { status: "in_transit" },
          { id: d.id },
        ),
      /Чужая/,
    );
    assert.throws(
      () =>
        f.call(
          "PATCH",
          "/deliveries/:id",
          f.courier,
          { courier_id: f.another.id },
          { id: d.id },
        ),
      /назначение/,
    );
    assert.throws(
      () =>
        f.call(
          "PATCH",
          "/deliveries/:id",
          f.courier,
          { status: "delivered" },
          { id: d.id },
        ),
      /переход/,
    );
    assert.throws(
      () =>
        f.call(
          "PATCH",
          "/deliveries/:id",
          f.courier,
          { status: "in_transit" },
          { id: d.id },
        ),
      /отгружен/,
    );
    f.db.prepare("UPDATE orders SET shipped_cents=1000 WHERE id=?").run("o");
    f.call(
      "PATCH",
      "/deliveries/:id",
      f.courier,
      { status: "in_transit" },
      { id: d.id },
    );
    f.call(
      "PATCH",
      "/deliveries/:id",
      f.courier,
      { status: "delivered" },
      { id: d.id },
    );
    assert.equal(
      f.db.prepare("SELECT paid_cents FROM orders WHERE id=?").get("o")
        .paid_cents,
      0,
    );
    assert.throws(
      () =>
        f.call(
          "GET",
          "/reports/overview",
          f.courier,
          {},
          {},
          { entity_id: "e" },
        ),
      /Нет прав/,
    );
  } finally {
    f.db.close();
  }
});

test("promotions validate range and ownership, visits stay private", () => {
  const f = fixture();
  try {
    const promo = {
      name: "Акция",
      starts_at: "2026-11-01",
      ends_at: "2026-11-30",
      discount_percent: 10,
      product_ids: ["p"],
    };
    assert.throws(
      () => f.call("POST", "/promotions", f.rep, promo),
      /Нет прав/,
    );
    assert.throws(
      () =>
        f.call("POST", "/promotions", f.owner, {
          ...promo,
          discount_percent: 101,
        }),
      /скидка/,
    );
    assert.throws(
      () =>
        f.call("POST", "/promotions", f.owner, {
          ...promo,
          ends_at: "2026-10-01",
        }),
      /позже/,
    );
    const p = f.call("POST", "/promotions", f.owner, promo);
    assert.deepEqual(p.product_ids, ["p"]);
    const v = f.call("POST", "/visits", f.rep, {
      client_id: "c",
      scheduled_at: "2026-11-06T10:00:00Z",
    });
    assert.throws(
      () =>
        f.call(
          "PATCH",
          "/visits/:id",
          { ...f.another, roles: ["rep"] },
          { status: "completed", result: "Встреча" },
          { id: v.id },
        ),
      /Чужой/,
    );
    f.call(
      "PATCH",
      "/visits/:id",
      f.rep,
      { status: "completed", result: "Заказ получен" },
      { id: v.id },
    );
    assert.throws(
      () =>
        f.call(
          "PATCH",
          "/visits/:id",
          f.rep,
          { status: "cancelled", reason: "Ошибка" },
          { id: v.id },
        ),
      /завершен/,
    );
  } finally {
    f.db.close();
  }
});

test("core purchase receipt is atomic and exact dated report follows shipment and return", () => {
  const f = fixture();
  try {
    const ctx = { db: f.db };
    installCore(ctx);
    let clock = "2026-11-05T10:00:00.000Z";
    ctx.now = () => clock;
    const routes = new Map(),
      add = (m, p, h) => routes.set(`${m} ${p}`, h);
    registerCore(add, ctx);
    registerExtensions(add, ctx);
    const call = (m, p, b = {}, params = {}, query = {}) =>
      ctx.tx(() =>
        routes.get(`${m} ${p}`)({ user: f.owner, body: b, params, query }),
      );
    const purchase = call("POST", "/purchases", {
      entity_id: "e",
      warehouse_id: "w",
      lines: [{ product_id: "p", qty: 10, cost_cents: 60 }],
    });
    call("POST", "/purchases/:id/receive", {}, { id: purchase.id });
    assert.throws(
      () => call("POST", "/purchases/:id/receive", {}, { id: purchase.id }),
      /уже принята/,
    );
    assert.equal(
      f.db.prepare("SELECT on_hand FROM inventory WHERE entity_id=?").get("e")
        .on_hand,
      10,
    );
    f.db
      .prepare(
        "INSERT INTO products(id,sku,name,pack_size,retail_cents,wholesale_cents,expiry_required,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run("dated", "DATED", "С годностью", 1, 100, 100, 1, clock);
    const broken = call("POST", "/purchases", {
      entity_id: "e",
      warehouse_id: "w",
      lines: [
        { product_id: "p", qty: 2, cost_cents: 60 },
        { product_id: "dated", qty: 1, cost_cents: 50 },
      ],
    });
    assert.throws(
      () => call("POST", "/purchases/:id/receive", {}, { id: broken.id }),
      /годности/,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT on_hand FROM inventory WHERE entity_id=? AND product_id=?",
        )
        .get("e", "p").on_hand,
      10,
    );
    assert.equal(
      f.db.prepare("SELECT status FROM purchases WHERE id=?").get(broken.id)
        .status,
      "ordered",
    );
    call("PATCH", "/settings", { retail_entity_id: "e" });
    const order = call("POST", "/orders", {
      entity_id: "e",
      warehouse_id: "w",
      channel: "retail",
      fulfillment: "pickup",
      lines: [{ product_id: "p", quantity: 4, unit: "piece" }],
    });
    call("POST", "/orders/:id/confirm", {}, { id: order.id });
    call("POST", "/payments", {
      entity_id: "e",
      order_id: order.id,
      amount_cents: 400,
      method: "cash",
    });
    clock = "2026-11-06T10:00:00.000Z";
    call("POST", "/orders/:id/ship", {}, { id: order.id });
    clock = "2026-11-07T10:00:00.000Z";
    call(
      "POST",
      "/orders/:id/return",
      { lines: [{ line_id: order.lines[0].id, qty: 1 }], reason: "Возврат" },
      { id: order.id },
    );
    assert.throws(
      () =>
        call(
          "POST",
          "/orders/:id/return",
          { lines: [{ line_id: order.lines[0].id, qty: 4 }], reason: "Повтор" },
          { id: order.id },
        ),
      /превышает/,
    );
    const report = call(
      "GET",
      "/reports/overview",
      {},
      {},
      { entity_id: "e", from: "2026-11-06", to: "2026-11-08" },
    );
    assert.equal(report.sales_cents, 300);
    assert.equal(report.cost_cents, 180);
    assert.equal(report.gross_profit_cents, 120);
    assert.equal(report.inventory_cents, 420);
    assert.equal(report.returns_cents, 100);
    const returnOnly = call(
      "GET",
      "/reports/overview",
      {},
      {},
      { entity_id: "e", from: "2026-11-07", to: "2026-11-08" },
    );
    assert.equal(returnOnly.sales_cents, -100);
    assert.equal(returnOnly.cost_cents, -60);
    f.db
      .prepare("UPDATE stock_movements SET cost_cents=NULL WHERE kind='return'")
      .run();
    const incomplete = call(
      "GET",
      "/reports/overview",
      {},
      {},
      { entity_id: "e" },
    );
    assert.equal(incomplete.gross_profit_cents, null);
    assert.equal(incomplete.cost_status, "incomplete");
  } finally {
    f.db.close();
  }
});
