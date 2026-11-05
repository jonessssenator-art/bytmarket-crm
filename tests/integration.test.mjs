import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/index.mjs";
import { createBackup } from "../scripts/backup.mjs";
import { verifyRestore } from "../scripts/restore-check.mjs";

async function start(path) {
  const app = createApp({ dbPath: path });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/api/v1`;
  let cookie = "",
    csrf = "";
  async function request(method, path, body, key = randomUUID()) {
    const headers = { "Content-Type": "application/json" };
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (method !== "GET") headers["Idempotency-Key"] = key;
    const r = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await r.json();
    if (data.csrf) csrf = data.csrf;
    return { status: r.status, data };
  }
  async function ok(method, path, body, key) {
    const r = await request(method, path, body, key);
    assert.ok(
      r.status < 300,
      `${method} ${path}: ${r.status} ${JSON.stringify(r.data)}`,
    );
    return r.data;
  }
  return { ...app, request, ok, base };
}

test("real HTTP flow persists documents, prevents duplicate money and restores backup", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bytmarket-api-test-"));
  let app;
  t.after(async () => {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const dbPath = join(dir, "crm.sqlite");
  app = await start(dbPath);
  assert.equal((await app.ok("GET", "/auth/status")).needs_setup, true);
  await app.ok("POST", "/auth/setup", {
    name: "Тестовый владелец",
    email: "owner@test.invalid",
    password: "Test-owner-824!secure",
  });
  const meta = await app.ok("GET", "/meta");
  const entity = meta.entities.find((x) => x.name.includes("ООО"));
  const ip = meta.entities.find((x) => x.name.includes("ИП"));
  const wh = meta.warehouses[0];
  assert.ok(entity && ip && wh);
  await app.ok("PATCH", "/settings", { wholesale_min_qty: 1 });
  assert.equal(
    (await app.ok("GET", "/products")).length,
    0,
    "no fake catalog seeded",
  );
  const p = await app.ok("POST", "/products", {
    sku: "T-001",
    name: "Тестовый порошок",
    pack_size: 12,
    retail_cents: 35000,
    wholesale_cents: 32000,
    min_stock: 50,
    unit: "шт.",
  });
  const c = await app.ok("POST", "/clients", {
    name: "Тестовый покупатель",
    kind: "company",
    term_days: 7,
    credit_limit_cents: 10000000,
  });
  await app.ok("POST", "/stock/receive", {
    entity_id: entity.id,
    warehouse_id: wh.id,
    product_id: p.id,
    qty: 61,
    cost_cents: 20000,
    reason: "Начальные остатки теста",
  });
  const order = await app.ok("POST", "/orders", {
    entity_id: entity.id,
    warehouse_id: wh.id,
    client_id: c.id,
    channel: "wholesale",
    fulfillment: "pickup",
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    lines: [{ product_id: p.id, quantity: 1, unit: "box" }],
  });
  assert.equal(order.total_cents, 384000);
  const confirmed = await app.ok("POST", `/orders/${order.id}/confirm`, {});
  assert.equal(confirmed.status, "confirmed");
  let stocks = await app.ok(
    "GET",
    `/stock?entity_id=${entity.id}&warehouse_id=${wh.id}`,
  );
  let stock = stocks.find((x) => x.product_id === p.id);
  assert.equal(stock.reserved, 12);
  assert.equal(stock.available, 49);
  let alerts = await app.ok("GET", "/alerts");
  assert.ok(alerts.some((x) => x.product_id === p.id && x.status === "open"));
  const paymentKey = randomUUID();
  const paymentBody = {
    entity_id: entity.id,
    client_id: c.id,
    order_id: order.id,
    amount_cents: 10000,
    method: "bank",
    reference: "TEST-BANK-001",
  };
  const pay = await app.ok("POST", "/payments", paymentBody, paymentKey);
  const duplicate = await app.ok("POST", "/payments", paymentBody, paymentKey);
  assert.equal(pay.id, duplicate.id);
  assert.ok(
    (
      await app.request(
        "POST",
        "/payments",
        { ...paymentBody, amount_cents: 11000 },
        paymentKey,
      )
    ).status >= 400,
  );
  assert.equal((await app.ok("GET", `/orders/${order.id}`)).paid_cents, 10000);
  await app.ok("POST", `/orders/${order.id}/ship`, {});
  const shipped = await app.ok("GET", `/orders/${order.id}`);
  assert.equal(shipped.lines[0].shipped_qty, 12);
  await app.ok("POST", `/orders/${order.id}/return`, {
    lines: [{ line_id: shipped.lines[0].id, qty: 3 }],
    reason: "Частичный возврат теста",
  });
  stocks = await app.ok(
    "GET",
    `/stock?entity_id=${entity.id}&warehouse_id=${wh.id}`,
  );
  stock = stocks.find((x) => x.product_id === p.id);
  assert.equal(stock.quarantine, 3);
  assert.equal(stock.available, 49);
  await app.ok("POST", "/stock/release", {
    entity_id: entity.id,
    warehouse_id: wh.id,
    product_id: p.id,
    qty: 3,
    reason: "Проверен, пригоден",
  });
  stocks = await app.ok(
    "GET",
    `/stock?entity_id=${entity.id}&warehouse_id=${wh.id}`,
  );
  assert.equal(stocks.find((x) => x.product_id === p.id).available, 52);
  alerts = await app.ok("GET", "/alerts");
  assert.ok(!alerts.some((x) => x.product_id === p.id && x.status === "open"));
  const cross = await app.ok("POST", "/orders", {
    entity_id: ip.id,
    warehouse_id: wh.id,
    channel: "retail",
    fulfillment: "pickup",
    lines: [{ product_id: p.id, quantity: 1, unit: "piece" }],
  });
  assert.ok(
    (await app.request("POST", `/orders/${cross.id}/confirm`, {})).status >=
      400,
    "IP cannot reserve LLC stock",
  );

  const overview = await app.ok(
    "GET",
    `/reports/overview?entity_id=${entity.id}`,
  );
  assert.equal(overview.sales_cents, 288000);
  assert.equal(overview.gross_profit_cents, 108000);
  assert.equal(
    overview.movements.reduce((sum, m) => sum + m.revenue_cents, 0),
    overview.sales_cents,
  );
  assert.equal(
    overview.receipt_documents.reduce((sum, p) => sum + p.amount_cents, 0),
    overview.receipts_cents,
  );
  assert.equal(
    overview.debt_documents.reduce((sum, o) => sum + o.debt_cents, 0),
    overview.debt_cents,
  );
  app.db
    .prepare("UPDATE stock_movements SET created_at=? WHERE kind='ship'")
    .run("2026-11-04T21:00:00.000Z");
  app.db
    .prepare("UPDATE stock_movements SET created_at=? WHERE kind='return'")
    .run("2026-11-05T21:00:00.000Z");
  const daily = await app.ok(
    "GET",
    `/reports/overview?entity_id=${entity.id}&from=2026-11-05&to=2026-11-06`,
  );
  assert.equal(
    daily.sales_cents,
    384000,
    "Astrakhan day includes 01:00 local shipment but excludes next-day return",
  );
  assert.equal(daily.movements.length, 1);
  const backup = await createBackup(dbPath, join(dir, "backups"));
  assert.equal((await verifyRestore(backup.path)).verified, true);
  await app.close();
  app = await start(dbPath);
  assert.equal((await app.ok("GET", "/auth/status")).needs_setup, false);
  await app.ok("POST", "/auth/login", {
    email: "owner@test.invalid",
    password: "Test-owner-824!secure",
  });
  const restoredOrder = await app.ok("GET", `/orders/${order.id}`);
  assert.equal(restoredOrder.paid_cents, 10000);
  assert.equal(restoredOrder.lines[0].returned_qty, 3);
});
