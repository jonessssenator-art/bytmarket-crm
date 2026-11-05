import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/index.mjs";

async function fixture(t) {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  function client() {
    let cookie = "",
      csrf = "";
    return {
      async req(method, path, body, extra = {}) {
        const headers = {
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
          ...extra,
        };
        const r = await fetch(base + "/api/v1" + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const set = r.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0];
        const data = await r.json();
        if (data.csrf) csrf = data.csrf;
        return { status: r.status, data, headers: r.headers };
      },
      async ok(...args) {
        const r = await this.req(...args);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        return r.data;
      },
    };
  }
  const owner = client();
  await owner.ok("POST", "/auth/setup", {
    name: "Владелец",
    email: "owner@example.test",
    password: "correct-horse-battery-1",
  });
  const meta = await owner.ok("GET", "/meta");
  const e = meta.entities.find((x) => x.kind === "ooo").id,
    ip = meta.entities.find((x) => x.kind === "ip").id,
    w = meta.warehouses[0].id;
  await owner.ok("PATCH", "/settings", { wholesale_min_qty: 1 });
  const customer = await owner.ok("POST", "/clients", {
    name: "Клиент",
    credit_limit_cents: 10000000,
    term_days: 7,
  });
  async function product(extra = {}) {
    return owner.ok("POST", "/products", {
      name: "Товар",
      sku: randomUUID(),
      pack_size: 12,
      retail_cents: 100,
      wholesale_cents: 100,
      ...extra,
    });
  }
  async function receive(p, qty = 1, extra = {}) {
    return owner.ok("POST", "/stock/receive", {
      entity_id: e,
      warehouse_id: w,
      product_id: p.id,
      qty,
      cost_cents: 60,
      reason: "Начальный пересчёт",
      ...extra,
    });
  }
  async function order(p, extra = {}) {
    return owner.ok("POST", "/orders", {
      entity_id: e,
      warehouse_id: w,
      client_id: customer.id,
      channel: "wholesale",
      fulfillment: "pickup",
      due_date: new Date(Date.now() + 3 * 86400000 + 4 * 3600000)
        .toISOString()
        .slice(0, 10),
      lines: [{ product_id: p.id, quantity: 1, unit: "piece" }],
      ...extra,
    });
  }
  async function staff(role, extra = {}) {
    const email = randomUUID() + "@example.test";
    const u = await owner.ok("POST", "/users", {
      name: role,
      email,
      password: "correct-horse-battery-2",
      roles: [role],
      entity_ids: [e],
      warehouse_ids: [w],
      ...extra,
    });
    const c = client();
    await c.ok("POST", "/auth/login", {
      email,
      password: "correct-horse-battery-2",
    });
    return { u, c };
  }
  return {
    app,
    base,
    client,
    owner,
    e,
    ip,
    w,
    product,
    receive,
    order,
    customer,
    staff,
  };
}

test("authentication, origin, CSRF, owner-only mutations and field masking", async (t) => {
  const f = await fixture(t),
    anon = f.client();
  assert.equal((await anon.req("GET", "/products")).status, 401);
  assert.equal(
    (
      await f.owner.req(
        "POST",
        "/products",
        { name: "X" },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.owner.req(
        "POST",
        "/products",
        { name: "X" },
        { "X-CSRF-Token": "" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await anon.req("POST", "/auth/setup", {
        name: "Other",
        email: "o@test.test",
        password: "long-password-2",
      })
    ).status,
    409,
  );
  const p = await f.product();
  await f.receive(p, 10);
  const { c: warehouse } = await f.staff("warehouse");
  const stock = await warehouse.ok(
    "GET",
    `/stock?entity_id=${f.e}&warehouse_id=${f.w}`,
  );
  assert.equal("cost_cents" in stock[0], false);
  assert.equal(
    (await warehouse.req("GET", `/stock?entity_id=${f.ip}`)).status,
    403,
  );
  assert.equal(
    (await warehouse.req("POST", "/products", { name: "Forbidden", sku: "F" }))
      .status,
    403,
  );
  const { u, c } = await f.staff("manager");
  const own = await c.ok("POST", "/clients", { name: "Assigned" });
  assert.equal(own.assigned_to, u.id);
  assert.equal((await c.ok("GET", "/clients")).length, 1);
  assert.equal(
    (await c.req("PATCH", `/clients/${f.customer.id}`, { name: "Leak" }))
      .status,
    404,
  );
  assert.equal((await c.req("GET", "/users")).status, 403);
});

test("concurrent last unit reserves once and duplicate command preserves one effect", async (t) => {
  const f = await fixture(t);
  const p = await f.product();
  await f.receive(p, 1);
  const a = await f.order(p),
    b = await f.order(p);
  const results = await Promise.all([
    f.owner.req("POST", `/orders/${a.id}/confirm`, {}),
    f.owner.req("POST", `/orders/${b.id}/confirm`, {}),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  const i = f.app.db.prepare("SELECT * FROM inventory").get();
  assert.equal(i.reserved, 1);
  assert.equal(i.on_hand, 1);
  const key = randomUUID(),
    payload = {
      entity_id: f.e,
      warehouse_id: f.w,
      product_id: p.id,
      qty: 12,
      cost_cents: 60,
      reason: "Повторяемая команда",
    };
  const [first, second] = await Promise.all([
    f.owner.req("POST", "/stock/receive", payload, { "Idempotency-Key": key }),
    f.owner.req("POST", "/stock/receive", payload, { "Idempotency-Key": key }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.data.id, first.data.id);
  assert.equal(
    (
      await f.owner.req(
        "POST",
        "/stock/receive",
        { ...payload, qty: 13 },
        { "Idempotency-Key": key },
      )
    ).status,
    409,
  );
  assert.equal(
    f.app.db.prepare("SELECT on_hand FROM inventory").get().on_hand,
    13,
  );
});

test("box snapshots, stale draft version, partial return quarantine and unchanged historic coefficient", async (t) => {
  const f = await fixture(t);
  const p = await f.product();
  await f.receive(p, 36);
  const o = await f.order(p, {
    lines: [{ product_id: p.id, quantity: 3, unit: "box" }],
  });
  assert.equal(o.lines[0].qty, 36);
  assert.equal(o.total_cents, 3600);
  assert.equal(
    (
      await f.owner.req("PATCH", `/orders/${o.id}`, {
        version: 0,
        notes: "stale",
      })
    ).status,
    409,
  );
  await f.owner.ok("POST", `/orders/${o.id}/confirm`, {});
  await f.owner.ok("PATCH", `/products/${p.id}`, {
    pack_size: 10,
    wholesale_cents: 120,
  });
  assert.equal(
    (await f.owner.ok("GET", `/orders/${o.id}`)).lines[0].unit_factor,
    12,
  );
  const { c: warehouse } = await f.staff("warehouse");
  await warehouse.ok("POST", `/orders/${o.id}/ship`, {
    lines: [{ line_id: o.lines[0].id, qty: 12 }],
  });
  await f.owner.ok("POST", `/orders/${o.id}/return`, {
    lines: [{ line_id: o.lines[0].id, qty: 3 }],
    reason: "Возврат",
  });
  assert.equal(
    (
      await f.owner.req("POST", `/orders/${o.id}/return`, {
        lines: [{ line_id: o.lines[0].id, qty: 10 }],
        reason: "Сверх исходного",
      })
    ).status,
    409,
  );
  let stock = f.app.db.prepare("SELECT * FROM inventory").get();
  assert.equal(stock.quarantine, 3);
  assert.equal(stock.reserved, 24);
  await f.owner.ok("POST", `/orders/${o.id}/cancel`, {
    reason: "Остаток отменён",
  });
  stock = f.app.db.prepare("SELECT * FROM inventory").get();
  assert.equal(stock.reserved, 0);
  assert.equal(stock.on_hand, 24);
  await f.owner.ok("POST", "/stock/release", {
    entity_id: f.e,
    warehouse_id: f.w,
    product_id: p.id,
    qty: 2,
    reason: "Проверен",
  });
  stock = f.app.db.prepare("SELECT * FROM inventory").get();
  assert.equal(stock.on_hand, 26);
  assert.equal(stock.quarantine, 1);
  const repeated = await f.owner.ok("POST", `/orders/${o.id}/repeat`, {});
  assert.equal(repeated.status, "draft");
  assert.equal(repeated.lines[0].qty, 30);
  assert.equal(repeated.lines[0].unit_price_cents, 120);
});

test("expired and marked goods cannot become available or be shipped", async (t) => {
  const f = await fixture(t);
  const expired = await f.product({ expiry_required: true });
  assert.equal(
    (
      await f.owner.req("POST", "/stock/receive", {
        entity_id: f.e,
        warehouse_id: f.w,
        product_id: expired.id,
        qty: 2,
        cost_cents: 50,
        reason: "Missing expiry",
      })
    ).status,
    400,
  );
  await f.receive(expired, 2, { expires_at: "2000-01-01" });
  const o = await f.order(expired);
  assert.equal(
    (await f.owner.req("POST", `/orders/${o.id}/confirm`, {})).status,
    409,
  );
  assert.equal(
    (
      await f.owner.req("POST", "/stock/release", {
        entity_id: f.e,
        warehouse_id: f.w,
        product_id: expired.id,
        qty: 1,
        reason: "Просрочен",
      })
    ).status,
    409,
  );
  const marked = await f.product({ marked: true });
  await f.receive(marked, 2);
  const m = await f.order(marked);
  assert.equal(
    (await f.owner.req("POST", `/orders/${m.id}/confirm`, {})).status,
    409,
  );
  assert.equal(
    (
      await f.owner.req("POST", "/stock/release", {
        entity_id: f.e,
        warehouse_id: f.w,
        product_id: marked.id,
        qty: 1,
        reason: "Нет проверки",
      })
    ).status,
    409,
  );
});

test("legal owner isolation and internal alert episode lifecycle", async (t) => {
  const f = await fixture(t);
  const p = await f.product();
  await f.receive(p, 50);
  const order = await f.order(p);
  await f.owner.ok("POST", `/orders/${order.id}/confirm`, {});
  let alerts = await f.owner.ok("GET", "/alerts");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].available, 49);
  await f.owner.ok("POST", `/alerts/${alerts[0].id}/read`, {});
  assert.equal((await f.owner.ok("GET", "/alerts"))[0].status, "open");
  await f.owner.ok("POST", "/stock/adjust", {
    entity_id: f.e,
    warehouse_id: f.w,
    product_id: p.id,
    qty: -1,
    reason: "Списание",
  });
  assert.equal((await f.owner.ok("GET", "/alerts")).length, 1);
  await f.receive(p, 2);
  assert.equal((await f.owner.ok("GET", "/alerts"))[0].status, "resolved");
  await f.owner.ok("POST", "/stock/adjust", {
    entity_id: f.e,
    warehouse_id: f.w,
    product_id: p.id,
    qty: -1,
    reason: "Списание",
  });
  alerts = await f.owner.ok("GET", "/alerts");
  assert.equal(alerts.length, 2);
  assert.equal(alerts.filter((a) => a.status === "open").length, 1);
  const ip = await f.order(p, { entity_id: f.ip, channel: "retail" });
  assert.equal(
    (await f.owner.req("POST", `/orders/${ip.id}/confirm`, {})).status,
    409,
  );
  const second = await f.owner.ok("POST", "/warehouses", {
    name: "Второй склад",
  });
  assert.equal(
    (
      await f.owner.req("POST", "/stock/transfer", {
        entity_id: f.e,
        to_entity_id: f.ip,
        warehouse_id: f.w,
        to_warehouse_id: second.id,
        product_id: p.id,
        qty: 1,
        reason: "Смена владельца",
      })
    ).status,
    400,
  );
});

test("atomic import rejects all rows and warehouse cannot bypass unpaid shipment policy", async (t) => {
  const f = await fixture(t);
  const rows = [
    { sku: "A", name: "A" },
    { sku: "A", name: "Duplicate" },
  ];
  const preview = await f.owner.ok("POST", "/products/import/preview", {
    rows,
  });
  assert.equal(preview.valid, false);
  assert.equal(
    (
      await f.owner.req("POST", "/products/import", {
        rows,
        preview_hash: preview.preview_hash,
      })
    ).status,
    400,
  );
  assert.equal((await f.owner.ok("GET", "/products")).length, 0);
  const p = await f.product();
  await f.receive(p, 1);
  const c = await f.owner.ok("POST", "/clients", { name: "Без отсрочки" });
  const o = await f.order(p, { client_id: c.id, due_date: null });
  await f.owner.ok("POST", `/orders/${o.id}/confirm`, {});
  const { c: warehouse } = await f.staff("warehouse");
  assert.equal(
    (await warehouse.req("POST", `/orders/${o.id}/ship`, {})).status,
    409,
  );
  assert.equal(
    f.app.db.prepare("SELECT reserved FROM inventory").get().reserved,
    1,
  );
});

test("cash on delivery requires explicit collection and assigned courier; delivery never clears debt", async (t) => {
  const f = await fixture(t),
    p = await f.product();
  await f.receive(p, 1, { entity_id: f.ip });
  const order = await f.owner.ok("POST", "/orders", {
    entity_id: f.ip,
    warehouse_id: f.w,
    channel: "retail",
    fulfillment: "delivery",
    address: "Тестовый адрес",
    lines: [{ product_id: p.id, quantity: 1, unit: "piece" }],
  });
  await f.owner.ok("POST", `/orders/${order.id}/confirm`, {});
  assert.equal(
    (await f.owner.req("POST", `/orders/${order.id}/ship`, {})).status,
    409,
  );
  const { u, c } = await f.staff("courier", { entity_ids: [f.ip] });
  const delivery = await f.owner.ok("POST", "/deliveries", {
    order_id: order.id,
    courier_id: u.id,
    address: "Тестовый адрес",
    collect_on_delivery: true,
  });
  await f.owner.ok("POST", `/orders/${order.id}/ship`, {});
  await c.ok("PATCH", `/deliveries/${delivery.id}`, { status: "in_transit" });
  await c.ok("PATCH", `/deliveries/${delivery.id}`, { status: "delivered" });
  assert.equal(
    (await f.owner.ok("GET", `/reports/overview?entity_id=${f.ip}`)).debt_cents,
    100,
  );
  await c.ok("POST", "/payments", {
    entity_id: f.ip,
    order_id: order.id,
    amount_cents: 100,
    method: "cash",
  });
  const report = await f.owner.ok("GET", `/reports/overview?entity_id=${f.ip}`);
  assert.equal(report.debt_cents, 0);
  assert.equal(report.cash_custody_cents, 100);
});
