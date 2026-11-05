import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
if (!process.argv.includes("--apply-demo"))
  throw Error("Explicit --apply-demo required; creates training data locally");
const path = "data/demo-expansion-state.json";
const state = existsSync(path)
  ? JSON.parse(readFileSync(path))
  : {
      steps: {},
      roles: JSON.parse(readFileSync("data/demo-audit-state.json")).roles,
      checks: [],
    };
const save = () =>
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
function client() {
  let cookie = "",
    csrf = "";
  return {
    async req(method, path, body, key = randomUUID()) {
      const r = await fetch("http://127.0.0.1:3000/api/v1" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      const data = await r.json();
      if (data.csrf) csrf = data.csrf;
      return { status: r.status, data };
    },
    async ok(...args) {
      const r = await this.req(...args);
      assert.equal(r.status, 200, args[1] + ": " + JSON.stringify(r.data));
      return r.data;
    },
    session() {
      return {
        cookies: [
          {
            name: "bytmarket_session",
            value: cookie.slice(cookie.indexOf("=") + 1),
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
            expires: -1,
          },
        ],
        origins: [],
      };
    },
  };
}
async function step(name, fn) {
  if (!(name in state.steps)) {
    state.steps[name] = await fn();
    save();
  }
  return state.steps[name];
}
const access = readFileSync("data/Доступ владельца.txt", "utf8");
const root = client();
await root.ok("POST", "/auth/login", {
  email: access.match(/^Логин:\s*(.+)$/m)[1].trim(),
  password: access.match(/^Пароль:\s*(.+)$/m)[1].trim(),
});
const meta = await root.ok("GET", "/meta");
const e = meta.entities.find((x) => x.kind === "ooo").id,
  ip = meta.entities.find((x) => x.kind === "ip").id,
  w = meta.warehouses[0].id;
state.scope = { e, ip, w };
state.settings ??= meta.settings;
save();
const names = {
  owner: "Владелец",
  seller: "Продавец",
  manager: "Менеджер",
  rep: "Торговый представитель",
  accountant: "Бухгалтер",
  warehouse: "Кладовщик",
  dispatcher: "Диспетчер",
  courier: "Курьер",
  other_courier: "Второй курьер",
};
const clients = {};
mkdirSync("data/audit-sessions", { recursive: true });
for (const [role, name] of Object.entries(names)) {
  if (!state.roles[role]) {
    state.roles[role] = {
      email: `test.${role}@bytmarket.local`,
      password: randomBytes(18).toString("base64url"),
    };
    save();
  }
  const a = state.roles[role];
  if (!a.user) throw Error("Existing training user required");
  const c = client();
  await c.ok("POST", "/auth/login", { email: a.email, password: a.password });
  clients[role] = c;
  writeFileSync(
    `data/audit-sessions/${role}.json`,
    JSON.stringify(c.session()),
    { mode: 0o600 },
  );
}
writeFileSync(
  "data/Тестовые роли.txt",
  "Учебные учётные записи. Не использовать для реальных операций.\nhttp://127.0.0.1:3000\n\n" +
    Object.entries(names)
      .map(
        ([r, n]) =>
          `${n}\nЛогин: ${state.roles[r].email}\nПароль: ${state.roles[r].password}\n`,
      )
      .join("\n"),
  { mode: 0o600 },
);
const previous = JSON.parse(readFileSync("data/demo-audit-state.json"));
const families = [
  ["Порошок для стирки", "Стирка", "кг"],
  ["Гель для стирки", "Стирка", "л"],
  ["Кондиционер для белья", "Стирка", "л"],
  ["Жидкое мыло", "Гигиена", "л"],
  ["Средство для посуды", "Кухня", "л"],
  ["Средство для пола", "Уборка", "л"],
  ["Средство для стёкол", "Уборка", "л"],
  ["Чистящий крем", "Уборка", "л"],
  ["Губки для посуды", "Хозтовары", "шт"],
  ["Мешки для мусора", "Хозтовары", "л"],
];
const aromas = [
  "Лимон",
  "Свежесть",
  "Лаванда",
  "Без аромата",
  "Яблоко",
  "Хлопок",
  "Алоэ",
  "Цветочный",
  "Морской",
];
const sizes = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15];
const products = await step("products-900", async () => {
  const rows = Array.from({ length: 900 }, (_, i) => {
    const [name, category, unit] = families[Math.floor(i / 90)];
    const volume = sizes[Math.floor((i % 90) / 9)] + unit;
    const raw = "291" + String(i + 101).padStart(9, "0");
    const check =
      (10 -
        ([...raw].reduce((s, n, j) => s + Number(n) * (j % 2 ? 3 : 1), 0) %
          10)) %
      10;
    return {
      sku: `TEST-1000-${String(i + 101).padStart(4, "0")}`,
      name: `[Тест] ${name} ${volume} / ${aromas[i % 9]}`,
      barcode: raw + check,
      category,
      brand: ["Учебная Чистота", "Учебный Дом", "Учебный Уют"][i % 3],
      pack_size: 12,
      retail_cents: 20000 + (i % 40) * 700,
      wholesale_cents: 17000 + (i % 40) * 600,
      min_stock: 50,
      attributes: {
        demo: true,
        volume,
        scent: aromas[i % 9],
        inner_pack_size: 3,
      },
    };
  });
  const preview = await root.ok("POST", "/products/import/preview", { rows });
  assert.equal(preview.valid, true, JSON.stringify(preview.errors));
  return (
    await root.ok(
      "POST",
      "/products/import",
      { rows, preview_hash: preview.preview_hash },
      "demo-expand-products-v1",
    )
  ).products;
});
console.log("Added 900 catalog positions");
const supplier = previous.steps.supplier;
for (const [key, entity] of [
  ["ooo", e],
  ["ip", ip],
])
  for (let batch = 0; batch < 9; batch++) {
    const p = await step(`purchase-${key}-${batch}`, () =>
      clients.accountant.ok("POST", "/purchases", {
        entity_id: entity,
        warehouse_id: w,
        supplier_id: supplier.id,
        notes: "[Тест] Наполнение 1000 SKU",
        lines: products
          .slice(batch * 100, batch * 100 + 100)
          .map((p, i) => ({
            product_id: p.id,
            qty: i < 5 ? 60 : 120,
            cost_cents: Math.round(
              p.wholesale_cents * (i % 10 === 0 ? 0.9 : 0.6),
            ),
          })),
      }),
    );
    await step(`receive-${key}-${batch}`, () =>
      clients.warehouse.ok("POST", `/purchases/${p.id}/receive`, {}),
    );
  }
await step("promotion", () =>
  root.ok("POST", "/promotions", {
    name: "[Тест] Чистый дом - скидка 5%",
    starts_at: new Date(Date.now() - 3600000).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    discount_percent: 5,
    product_ids: products.slice(10, 25).map((p) => p.id),
  }),
);
const day = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10),
  month = day.slice(0, 7) + "-01",
  end = day.slice(0, 7) + "-28";
await root.ok("PATCH", "/settings", { wholesale_min_qty: 1 });
try {
  for (const role of ["rep", "manager", "seller"]) {
    const entity = role === "seller" ? ip : e;
    for (let j = 0; j < 4; j++)
      await step(`customer-${role}-${j}`, () =>
        root.ok("POST", "/clients", {
          name: `[Тест] ${["Лотос", "Каспий", "Волга", "Южный"][j]} / ${names[role]}`,
          assigned_to: state.roles[role].user.id,
          credit_limit_cents: 50000000,
          term_days: 14,
          address: "Астрахань, учебная торговая точка " + (j + 1),
        }),
      );
    await step("plan-" + role, () =>
      root.ok("POST", "/plans", {
        entity_id: entity,
        user_id: state.roles[role].user.id,
        starts_at: month,
        ends_at: end,
        amount_cents: 30000000,
      }),
    );
    for (let i = 0; i < 12; i++) {
      const customer = state.steps[`customer-${role}-${i % 4}`],
        offset = (role === "rep" ? 0 : role === "manager" ? 100 : 200) + i * 5;
      const order = await step(`order-${role}-${i}`, () =>
        clients[role].ok("POST", "/orders", {
          entity_id: entity,
          warehouse_id: w,
          client_id: customer.id,
          channel: role === "seller" ? "retail" : "wholesale",
          fulfillment: i % 3 === 0 ? "delivery" : "pickup",
          address: customer.address,
          notes: `[Тест] Аналитика: ${names[role]}, сценарий ${i + 1}`,
          lines: products
            .slice(offset, offset + 5)
            .map((p, j) => ({
              product_id: p.id,
              quantity: i === 0 ? 2 : 1,
              unit: role === "seller" ? "piece" : "box",
            })),
        }),
      );
      if (i === 11) continue;
      await step(`confirm-${role}-${i}`, () =>
        clients[role].ok("POST", `/orders/${order.id}/confirm`, {}),
      );
      if (i === 10) continue;
      let delivery;
      if (i % 3 === 0)
        delivery = await step(`delivery-${role}-${i}`, () =>
          clients.dispatcher.ok("POST", "/deliveries", {
            order_id: order.id,
            courier_id:
              state.roles[i === 6 ? "other_courier" : "courier"].user.id,
            collect_on_delivery: true,
            places: 5,
            interval: "10:00 - 18:00",
            phone: "+70000000000",
          }),
        );
      if (i !== 9)
        await step(`pay-${role}-${i}`, () =>
          clients.accountant.ok("POST", "/payments", {
            entity_id: entity,
            order_id: order.id,
            amount_cents: order.total_cents,
            method: "bank",
            reference: "[Тест] Учебное подтверждение оплаты",
          }),
        );
      await step(`ship-${role}-${i}`, () =>
        clients.warehouse.ok("POST", `/orders/${order.id}/ship`, {}),
      );
      if (delivery) {
        const courier = clients[i === 6 ? "other_courier" : "courier"];
        await step(`delivery-detail-${role}-${i}`, () =>
          root.ok("POST", `/deliveries/${delivery.id}/details`, {
            deadline_at: new Date(Date.now() + 86400000).toISOString(),
            fee_cents: 30000,
            cost_cents: 15000,
          }),
        );
        if (i !== 6)
          await step(`transit-${role}-${i}`, () =>
            courier.ok("PATCH", `/deliveries/${delivery.id}`, {
              status: "in_transit",
            }),
          );
        if (i === 0)
          await step(`done-${role}-${i}`, () =>
            courier.ok("PATCH", `/deliveries/${delivery.id}`, {
              status: "delivered",
            }),
          );
        if (i === 3)
          await step(`failed-${role}-${i}`, () =>
            courier.ok("PATCH", `/deliveries/${delivery.id}`, {
              status: "failed",
              reason: "[Тест] Клиент перенёс получение",
            }),
          );
      }
    }
  }
  for (const [key, entity] of [
    ["ooo", e],
    ["ip", ip],
  ]) {
    await step("plan-" + key, () =>
      root.ok("POST", "/plans", {
        entity_id: entity,
        starts_at: month,
        ends_at: end,
        amount_cents: 60000000,
      }),
    );
    for (const [i, category] of ["Доставка", "Аренда", "Упаковка"].entries())
      await step(`expense-${key}-${i}`, () =>
        clients.accountant.ok("POST", "/expenses", {
          entity_id: entity,
          category,
          amount_cents: (i + 1) * 150000,
          date: day,
          note: "[Тест] Учебный расход",
        }),
      );
    await step("supplier-pay-" + key, () =>
      clients.accountant.ok("POST", "/supplier-ledger", {
        entity_id: entity,
        supplier_id: supplier.id,
        kind: "payment",
        amount_cents: 10000000,
        reason: "[Тест] Частичная оплата поставщику",
      }),
    );
  }
  for (let i = 0; i < 4; i++) {
    const v = await step("visit-" + i, () =>
      clients.rep.ok("POST", "/visits", {
        client_id: state.steps["customer-rep-" + i].id,
        scheduled_at: new Date(Date.now() + i * 3600000).toISOString(),
        note: "[Тест] План визита по торговой точке",
      }),
    );
    if (i === 0)
      await step("visit-result", () =>
        clients.rep.ok("PATCH", `/visits/${v.id}`, {
          status: "completed",
          result: "[Тест] Повторный заказ",
        }),
      );
  }
  console.log(
    "Trading scenarios, plans, promotions, expenses and delivery queues populated",
  );
} finally {
  await root.ok("PATCH", "/settings", {
    wholesale_min_qty: state.settings.wholesale_min_qty,
  });
}
for (const [key, entity, role] of [
  ["ooo", e, "rep"],
  ["ip", ip, "seller"],
]) {
  await step("opening-" + key, () =>
    clients.accountant.ok("POST", "/opening-debts", {
      entity_id: entity,
      client_id: state.steps[`customer-${role}-0`].id,
      amount_cents: 450000,
      due_date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      reason: "[Тест] Учебный начальный долг, не реальные обязательства",
    }),
  );
  await step("writeoff-" + key, () =>
    root.ok("POST", "/stock/adjust", {
      entity_id: entity,
      warehouse_id: w,
      product_id: products[850].id,
      qty: -2,
      reason: "[Тест] Повреждение упаковки",
    }),
  );
  await step("expected-" + key, () =>
    clients.accountant.ok("POST", "/purchases", {
      entity_id: entity,
      warehouse_id: w,
      supplier_id: supplier.id,
      expected_at: new Date(Date.now() + 2 * 86400000)
        .toISOString()
        .slice(0, 10),
      notes: "[Тест] Ожидаемое пополнение",
      lines: products
        .slice(0, 3)
        .map((p) => ({ product_id: p.id, qty: 120, cost_cents: 12000 })),
    }),
  );
}
const unpaid = state.steps["order-rep-9"];
await step("cash-in-custody", () =>
  clients.rep.ok("POST", "/payments", {
    entity_id: e,
    order_id: unpaid.id,
    amount_cents: 100000,
    method: "cash",
    note: "[Тест] Наличные до сдачи бухгалтеру",
  }),
);
await root.ok("PATCH", "/settings", { digest_hour: 0 });
try {
  await root.ok("GET", `/owner-digests?entity_id=${e}`);
  await root.ok("GET", `/owner-digests?entity_id=${ip}`);
} finally {
  await root.ok("PATCH", "/settings", {
    digest_hour: meta.settings.digest_hour ?? 9,
  });
}
console.log(
  "Attention, supplier pipeline, custody and daily summaries populated",
);
await root.ok("PATCH", "/settings", { wholesale_min_qty: 1 });
try {
  for (const [role, entity] of [
    ["manager", e],
    ["seller", ip],
  ]) {
    const order = await step("category-order-" + role, () =>
      clients[role].ok("POST", "/orders", {
        entity_id: entity,
        warehouse_id: w,
        client_id: state.steps[`customer-${role}-2`].id,
        channel: role === "seller" ? "retail" : "wholesale",
        fulfillment: "pickup",
        notes: "[Тест] Продажи всех товарных категорий",
        lines: families.map((_, i) => ({
          product_id: products[i * 90 + 80].id,
          quantity: 12,
          unit: "piece",
        })),
      }),
    );
    await step("category-confirm-" + role, () =>
      clients[role].ok("POST", `/orders/${order.id}/confirm`, {}),
    );
    await step("category-pay-" + role, () =>
      clients.accountant.ok("POST", "/payments", {
        entity_id: entity,
        order_id: order.id,
        amount_cents: order.total_cents,
        method: "bank",
        reference: "[Тест] Продажи категорий",
      }),
    );
    await step("category-ship-" + role, () =>
      clients.warehouse.ok("POST", `/orders/${order.id}/ship`, {}),
    );
  }
} finally {
  await root.ok("PATCH", "/settings", {
    wholesale_min_qty: state.settings.wholesale_min_qty,
  });
}
// Training-only proposal; commercial minimum must be agreed before real sales.
await root.ok("PATCH", "/settings", { wholesale_min_qty: 1 });
const partial = await step("partial-shipment-order", () =>
  clients.manager.ok("POST", "/orders", {
    entity_id: e,
    warehouse_id: w,
    client_id: state.steps["customer-manager-1"].id,
    channel: "wholesale",
    fulfillment: "pickup",
    notes: "[Тест] Частичная выдача, остаток готов к сборке",
    lines: [{ product_id: products[700].id, quantity: 12, unit: "piece" }],
  }),
);
await step("partial-shipment-confirm", () =>
  clients.manager.ok("POST", `/orders/${partial.id}/confirm`, {}),
);
await step("partial-shipment-pay", () =>
  clients.accountant.ok("POST", "/payments", {
    entity_id: e,
    order_id: partial.id,
    amount_cents: partial.total_cents,
    method: "bank",
    reference: "[Тест] Частичная выдача",
  }),
);
await step("partial-shipment-post", () =>
  clients.warehouse.ok("POST", `/orders/${partial.id}/ship`, {
    lines: [{ line_id: partial.lines[0].id, qty: 6 }],
  }),
);
for (const role of Object.keys(names))
  await step("role-task-" + role, () =>
    root.ok("POST", "/tasks", {
      entity_id: role === "seller" ? ip : e,
      assigned_to: state.roles[role].user.id,
      title: "[Тест] Проверить свою рабочую очередь",
      due_date: day,
      note: "Учебное задание: открыть документы и проверить доступные действия",
    }),
  );
