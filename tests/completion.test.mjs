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

test("partial purchasing records only accepted goods and supplier balance, refuses overreceipt", async (t) => {
  const f = await fixture(t),
    p = await f.product(),
    supplier = await f.owner.ok("POST", "/clients", {
      name: "Поставщик",
      kind: "supplier",
    });
  const order = await f.owner.ok("POST", "/purchases", {
    entity_id: f.e,
    warehouse_id: f.w,
    supplier_id: supplier.id,
    lines: [{ product_id: p.id, qty: 10, cost_cents: 60 }],
  });
  const list = await f.owner.ok("GET", "/purchases"),
    line = list[0].lines[0];
  const first = await f.owner.ok(
    "POST",
    "/purchases/" + order.id + "/receive",
    { lines: [{ line_id: line.id, qty: 4 }], due_date: "2099-01-01" },
  );
  assert.equal(first.status, "partially_received");
  assert.equal(
    (
      await f.owner.ok(
        "GET",
        "/stock?entity_id=" + f.e + "&warehouse_id=" + f.w,
      )
    )[0].available,
    4,
  );
  assert.equal(
    (
      await f.owner.req("POST", "/purchases/" + order.id + "/receive", {
        lines: [{ line_id: line.id, qty: 7 }],
      })
    ).status,
    400,
  );
  await f.owner.ok("POST", "/purchases/" + order.id + "/receive", {
    lines: [{ line_id: line.id, qty: 2, quarantine: true, reason: "Протечка" }],
  });
  const batches = await f.owner.ok(
    "GET",
    "/stock/batches?entity_id=" + f.e + "&warehouse_id=" + f.w,
  );
  await f.owner.ok("POST", "/supplier-returns", {
    batch_id: batches.find((b) => b.quarantine).id,
    qty: 1,
    quarantine: true,
    reason: "Возврат брака",
  });
  await f.owner.ok("POST", "/supplier-ledger", {
    entity_id: f.e,
    supplier_id: supplier.id,
    kind: "payment",
    amount_cents: 100,
    reason: "Платёж 1",
  });
  const ledger = await f.owner.ok("GET", "/supplier-ledger?entity_id=" + f.e);
  assert.equal(
    ledger.reduce((s, r) => s + r.amount_cents, 0),
    200,
  );
  await f.owner.ok("POST", "/purchases/" + order.id + "/close", {
    reason: "Поставщик снял остаток",
  });
  assert.equal(
    (await f.owner.req("POST", "/purchases/" + order.id + "/receive", {}))
      .status,
    409,
  );
});

test("stocktake rejects changed snapshot and reserved shortages, posts explicit batch variances", async (t) => {
  const f = await fixture(t),
    p = await f.product();
  const batch = await f.receive(p, 10);
  const take = await f.owner.ok("POST", "/stocktakes", {
    entity_id: f.e,
    warehouse_id: f.w,
    reason: "Пересчёт",
  });
  const counts = { [batch.batch_id]: { qty: 8, quarantine: 1 } };
  await f.owner.ok("POST", "/stocktakes/" + take.id + "/post", { counts });
  const stock = (
    await f.owner.ok("GET", "/stock?entity_id=" + f.e + "&warehouse_id=" + f.w)
  )[0];
  assert.equal(stock.on_hand, 8);
  assert.equal(stock.quarantine, 1);
  assert.equal(
    (await f.owner.req("POST", "/stocktakes/" + take.id + "/post", { counts }))
      .status,
    409,
  );
  const stale = await f.owner.ok("POST", "/stocktakes", {
    entity_id: f.e,
    warehouse_id: f.w,
    reason: "Второй пересчёт",
  });
  await f.receive(p, 1);
  assert.equal(
    (await f.owner.req("POST", "/stocktakes/" + stale.id + "/post", { counts }))
      .status,
    409,
  );
});

test("opening debt payment cannot be allocated again or exceed remaining debt", async (t) => {
  const f = await fixture(t),
    p = await f.product();
  const debt = await f.owner.ok("POST", "/opening-debts", {
    entity_id: f.e,
    client_id: f.customer.id,
    amount_cents: 500,
    reason: "Блокнот 1",
  });
  const pay = await f.owner.ok("POST", "/opening-debts/" + debt.id + "/pay", {
    amount_cents: 200,
    method: "bank",
    reference: "Выписка",
  });
  const remaining = await f.owner.ok("GET", "/opening-debts?entity_id=" + f.e);
  assert.equal(remaining[0].remaining_cents, 300);
  await f.receive(p, 1);
  const o = await f.order(p);
  await f.owner.ok("POST", "/orders/" + o.id + "/confirm", {});
  assert.equal(
    (
      await f.owner.req("POST", "/payments/" + pay.id + "/allocate", {
        allocations: [{ order_id: o.id, amount_cents: 100 }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.owner.req("POST", "/opening-debts/" + debt.id + "/pay", {
        amount_cents: 301,
        method: "cash",
      })
    ).status,
    400,
  );
});

test("individual prices, approval version invalidation, task ownership and document snapshot", async (t) => {
  const f = await fixture(t),
    p = await f.product();
  await f.receive(p, 10);
  const staff = await f.staff("rep");
  await f.owner.ok("PATCH", "/clients/" + f.customer.id, {
    assigned_to: staff.u.id,
  });
  await f.owner.ok("POST", "/client-prices", {
    entity_id: f.e,
    client_id: f.customer.id,
    product_id: p.id,
    price_cents: 90,
  });
  const o = await staff.c.ok("POST", "/orders", {
    entity_id: f.e,
    warehouse_id: f.w,
    client_id: f.customer.id,
    channel: "wholesale",
    fulfillment: "pickup",
    lines: [
      { product_id: p.id, quantity: 1, unit: "piece", discount_percent: 10 },
    ],
  });
  assert.equal(o.total_cents, 81);
  assert.equal(
    (await staff.c.req("POST", "/orders/" + o.id + "/confirm", {})).status,
    409,
  );
  const a = await staff.c.ok("POST", "/orders/" + o.id + "/approval", {
    kind: "price",
    reason: "Согласованная скидка",
  });
  await f.owner.ok("POST", "/approvals/" + a.id + "/decide", {
    status: "approved",
  });
  await staff.c.ok("PATCH", "/orders/" + o.id, {
    version: o.version,
    notes: "Изменение",
  });
  assert.equal(
    (await staff.c.req("POST", "/orders/" + o.id + "/confirm", {})).status,
    409,
  );
  const task = await staff.c.ok("POST", "/tasks", {
    entity_id: f.e,
    title: "Позвонить",
    due_date: "2099-01-01",
    client_id: f.customer.id,
  });
  const other = await f.staff("rep");
  assert.equal((await other.c.ok("GET", "/tasks?entity_id=" + f.e)).length, 0);
  assert.equal(
    (await other.c.req("PATCH", "/tasks/" + task.id, { status: "done" }))
      .status,
    403,
  );
  const doc = await f.owner.ok("POST", "/orders/" + o.id + "/document", {
    kind: "invoice",
  });
  await f.owner.ok("PATCH", "/entities/" + f.e, { name: "Новое название" });
  const same = await f.owner.ok("POST", "/orders/" + o.id + "/document", {
    kind: "invoice",
  });
  assert.equal(same.id, doc.id);
  assert.equal(same.content.entity.name, doc.content.entity.name);
});

test("import preview writes nothing, changed or duplicate rows roll back completely", async (t) => {
  const f = await fixture(t),
    p = await f.product();
  const body = {
    kind: "balances",
    entity_id: f.e,
    warehouse_id: f.w,
    rows: [{ sku: p.sku, qty: "5", cost_cents: "60", reason: "Блокнот" }],
  };
  const preview = await f.owner.ok("POST", "/imports/preview", body);
  assert.equal(preview.errors.length, 0);
  assert.equal(
    (
      await f.owner.ok(
        "GET",
        "/stock?entity_id=" + f.e + "&warehouse_id=" + f.w,
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await f.owner.req("POST", "/imports/commit", {
        ...body,
        preview_hash: "wrong",
      })
    ).status,
    409,
  );
  await f.owner.ok("POST", "/imports/commit", {
    ...body,
    preview_hash: preview.preview_hash,
  });
  const bad = {
    ...body,
    rows: [...body.rows, { sku: "missing", qty: "1", reason: "Test" }],
  };
  const check = await f.owner.ok("POST", "/imports/preview", bad);
  assert.equal(check.errors.length, 1);
  assert.equal(
    (
      await f.owner.req("POST", "/imports/commit", {
        ...bad,
        preview_hash: check.preview_hash,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.owner.ok(
        "GET",
        "/stock?entity_id=" + f.e + "&warehouse_id=" + f.w,
      )
    )[0].on_hand,
    5,
  );
  const clients = {
    kind: "clients",
    entity_id: f.e,
    warehouse_id: f.w,
    rows: [{ name: "Новый клиент", inn: "1234" }],
  };
  const cp = await f.owner.ok("POST", "/imports/preview", clients);
  assert.equal(cp.errors.length, 0);
  await f.owner.ok("POST", "/imports/commit", {
    ...clients,
    preview_hash: cp.preview_hash,
  });
  assert.equal((await f.owner.ok("GET", "/clients")).length, 2);
});

test("detailed reports distinguish equal names, plans reject overlap", async (t) => {
  const f = await fixture(t),
    p = await f.product(),
    p2 = await f.product();
  await f.receive(p, 2);
  await f.receive(p2, 2);
  for (const product of [p, p2]) {
    const o = await f.order(product);
    await f.owner.ok("POST", "/orders/" + o.id + "/confirm", {});
    await f.owner.ok("POST", "/payments", {
      entity_id: f.e,
      order_id: o.id,
      amount_cents: 100,
      method: "cash",
    });
    await f.owner.ok("POST", "/orders/" + o.id + "/ship", {});
  }
  const day = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const r = await f.owner.ok(
    "GET",
    "/reports/detail?entity_id=" + f.e + "&from=" + day + "&to=" + day,
  );
  assert.equal(r.products.length, 2);
  assert.equal(
    r.products.reduce((s, x) => s + x.sales_cents, 0),
    200,
  );
  assert.equal(r.employees.length, 1);
  const plan = {
    entity_id: f.e,
    starts_at: day,
    ends_at: day,
    amount_cents: 1000,
  };
  await f.owner.ok("POST", "/plans", plan);
  assert.equal((await f.owner.req("POST", "/plans", plan)).status, 400);
  assert.equal(
    (await f.owner.ok("GET", "/plans?entity_id=" + f.e))[0].actual_cents,
    200,
  );
  const debt = await f.owner.ok("POST", "/opening-debts", {
    entity_id: f.e,
    client_id: f.customer.id,
    amount_cents: 500,
    reason: "Начальный долг",
  });
  assert.equal(
    (await f.owner.ok("GET", "/reports/overview?entity_id=" + f.e)).debt_cents,
    500,
  );
  const report = await f.owner.ok(
    "GET",
    "/reports/operations?entity_id=" + f.e + "&from=" + day + "&to=" + day,
  );
  assert.equal(report.current.sales_cents, 200);
  assert.equal(report.inventory.length, 2);
});

test("permission changes mask costs, block returns and affect existing sessions", async (t) => {
  const f = await fixture(t),
    p = await f.product();
  await f.receive(p, 10);
  const accountant = await f.staff("accountant");
  assert.equal(
    (
      await accountant.c.ok(
        "GET",
        "/stock?entity_id=" + f.e + "&warehouse_id=" + f.w,
      )
    )[0].cost_cents,
    60,
  );
  await f.owner.ok("POST", "/user-permissions", {
    user_id: accountant.u.id,
    permissions: { view_cost: false, returns: false },
  });
  assert.equal(
    (
      await accountant.c.ok(
        "GET",
        "/stock?entity_id=" + f.e + "&warehouse_id=" + f.w,
      )
    )[0].cost_cents,
    undefined,
  );
  assert.equal(
    (await accountant.c.req("GET", "/reports/overview?entity_id=" + f.e))
      .status,
    403,
  );
  assert.equal((await accountant.c.req("POST", "/refunds", {})).status, 403);
  assert.equal(
    (
      await accountant.c.req("POST", "/user-permissions", {
        user_id: accountant.u.id,
        permissions: { view_cost: true },
      })
    ).status,
    403,
  );
});

test("inner packs and boxes snapshot separately, photo rejects non-images, digest forms once daily", async (t) => {
  const f = await fixture(t),
    p = await f.product({ pack_size: 12, attributes: { inner_pack_size: 3 } });
  await f.receive(p, 50);
  const pack = await f.order(p, {
    lines: [{ product_id: p.id, quantity: 2, unit: "pack" }],
  });
  assert.equal(pack.lines[0].qty, 6);
  assert.equal(pack.lines[0].unit_factor, 3);
  const box = await f.order(p, {
    lines: [{ product_id: p.id, quantity: 2, unit: "box" }],
  });
  assert.equal(box.lines[0].qty, 24);
  assert.equal(
    (
      await f.owner.req("POST", "/products/" + p.id + "/photo", {
        image:
          "data:image/png;base64," +
          Buffer.from("not a png image at all").toString("base64"),
      })
    ).status,
    400,
  );
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  await f.owner.ok("POST", "/products/" + p.id + "/photo", { image: png });
  assert.equal(
    (await f.owner.ok("GET", "/products/" + p.id + "/photo")).image,
    png,
  );
  await f.owner.ok("PATCH", "/settings", { digest_hour: 0 });
  const first = await f.owner.ok("GET", "/owner-digests?entity_id=" + f.e);
  const second = await f.owner.ok("GET", "/owner-digests?entity_id=" + f.e);
  assert.equal(first.length, 1);
  assert.equal(second[0].id, first[0].id);
});

test("credit beyond agreed days requires explicit owner approval", async (t) => {
  const f = await fixture(t),
    p = await f.product();
  await f.receive(p, 2);
  await f.owner.ok("PATCH", "/settings", { allow_credit: true });
  const o = await f.order(p, { due_date: "2099-01-01" });
  await f.owner.ok("POST", "/orders/" + o.id + "/confirm", {});
  assert.equal(
    (await f.owner.req("POST", "/orders/" + o.id + "/ship", {})).status,
    409,
  );
  const request = await f.owner.ok("POST", "/orders/" + o.id + "/approval", {
    kind: "credit",
    reason: "Разовое исключение",
  });
  await f.owner.ok("POST", "/approvals/" + request.id + "/decide", {
    status: "approved",
  });
  await f.owner.ok("POST", "/orders/" + o.id + "/ship", {});
  assert.equal(
    (await f.owner.ok("GET", "/reports/overview?entity_id=" + f.e)).debt_cents,
    100,
  );
});
