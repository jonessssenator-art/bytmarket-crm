import { createHash } from "node:crypto";
// Additional trading documents. Mutations run in the common idempotent transaction.
export function initCompletion(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS purchase_receipts(id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchases(id),line_id TEXT NOT NULL REFERENCES purchase_lines(id),batch_id TEXT REFERENCES stock_batches(id),qty INTEGER NOT NULL CHECK(qty>0),quarantine INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supplier_ledger(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),supplier_id TEXT NOT NULL REFERENCES clients(id),kind TEXT NOT NULL,amount_cents INTEGER NOT NULL,source_id TEXT,reason TEXT NOT NULL,due_date TEXT,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS opening_debts(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),client_id TEXT NOT NULL REFERENCES clients(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),due_date TEXT,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS opening_allocations(id TEXT PRIMARY KEY,debt_id TEXT NOT NULL REFERENCES opening_debts(id),payment_id TEXT NOT NULL REFERENCES payments(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0));
 CREATE TABLE IF NOT EXISTS stocktakes(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),status TEXT NOT NULL,snapshot TEXT NOT NULL,counts TEXT NOT NULL DEFAULT '{}',reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,posted_at TEXT);
 CREATE TABLE IF NOT EXISTS client_prices(entity_id TEXT NOT NULL REFERENCES entities(id),client_id TEXT NOT NULL REFERENCES clients(id),product_id TEXT NOT NULL REFERENCES products(id),price_cents INTEGER NOT NULL CHECK(price_cents>=0),PRIMARY KEY(entity_id,client_id,product_id));
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),client_id TEXT REFERENCES clients(id),assigned_to TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),version INTEGER NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,requested_by TEXT NOT NULL REFERENCES users(id),decided_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,decided_at TEXT);
 CREATE TABLE IF NOT EXISTS packing(order_id TEXT PRIMARY KEY REFERENCES orders(id),status TEXT NOT NULL,lines TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS document_snapshots(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),version INTEGER NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS product_photos(product_id TEXT PRIMARY KEY REFERENCES products(id),image TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS owner_digests(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),day TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,day));
 CREATE TABLE IF NOT EXISTS user_permissions(user_id TEXT PRIMARY KEY REFERENCES users(id),permissions TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sales_plans(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),user_id TEXT REFERENCES users(id),starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,amount_cents INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS delivery_details(delivery_id TEXT PRIMARY KEY REFERENCES deliveries(id),deadline_at TEXT,fee_cents INTEGER NOT NULL DEFAULT 0,cost_cents INTEGER NOT NULL DEFAULT 0,delivered_at TEXT);
 CREATE TABLE IF NOT EXISTS stock_days(entity_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,product_id TEXT NOT NULL,day TEXT NOT NULL,available INTEGER NOT NULL,PRIMARY KEY(entity_id,warehouse_id,product_id,day));
 CREATE INDEX IF NOT EXISTS supplier_ledger_scope ON supplier_ledger(entity_id,supplier_id);
 `);
  // Preserve previously fully received purchases without creating stock twice.
  db.exec(`INSERT INTO purchase_receipts SELECT 'legacy-'||l.id,p.id,l.id,NULL,l.qty,0,'Приёмка до обновления',p.created_by,COALESCE(p.received_at,p.created_at) FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id WHERE p.status='received' AND NOT EXISTS(SELECT 1 FROM purchase_receipts r WHERE r.line_id=l.id);
 INSERT INTO supplier_ledger SELECT 'legacy-'||p.id,p.entity_id,p.supplier_id,'receipt',SUM(l.qty*l.cost_cents),p.id,'Приёмка до обновления',NULL,p.created_by,COALESCE(p.received_at,p.created_at) FROM purchases p JOIN purchase_lines l ON l.purchase_id=p.id WHERE p.status='received' AND p.supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM supplier_ledger s WHERE s.source_id=p.id) GROUP BY p.id;`);
}

export function registerCompletion(add, ctx) {
  const {
    get,
    all,
    run,
    id,
    now,
    tx,
    scope,
    requireRole,
    audit,
    has,
    finance,
  } = ctx;
  const bad = (m, s = 400) => ctx.error(s, m);
  const integer = (v, label, min = 0) => {
    if (!Number.isSafeInteger(v) || v < min || v > 1e12)
      bad("Проверьте: " + label);
    return v;
  };
  const str = (v, label, required = false) => {
    if (v == null && !required) return "";
    if (typeof v !== "string" || v.length > 4000 || (required && !v.trim()))
      bad("Проверьте: " + label);
    return v.trim();
  };
  const day = (v) => {
    if (!v) return null;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v
    )
      bad("Некорректная дата");
    return v;
  };
  const today = () =>
    new Date(Date.parse(now()) + 4 * 3600000).toISOString().slice(0, 10);
  const visible = (u, e, w) =>
    has(u, "owner") ||
    (u.entity_ids.includes(e) && (!w || u.warehouse_ids.includes(w)));
  const client = (u, cid) => {
    const c = get("SELECT * FROM clients WHERE id=?", cid);
    if (!c || !ctx.canClient(u, c)) bad("Клиент недоступен", 403);
    return c;
  };
  const purchase = (u, pid) => {
    requireRole(u, "accountant", "warehouse");
    const p = get("SELECT * FROM purchases WHERE id=?", pid);
    if (!p) bad("Закупка не найдена", 404);
    scope(u, p.entity_id, p.warehouse_id);
    return p;
  };
  const received = (lid) =>
    get(
      "SELECT COALESCE(SUM(qty),0) n FROM purchase_receipts WHERE line_id=?",
      lid,
    ).n;
  const ledger = (u, e, s, kind, amount, source, reason, due = null) => {
    integer(Math.abs(amount), "сумма");
    const key = id();
    run(
      "INSERT INTO supplier_ledger VALUES(?,?,?,?,?,?,?,?,?,?)",
      key,
      e,
      s,
      kind,
      amount,
      source,
      reason,
      due,
      u.id,
      now(),
    );
    return key;
  };
  const openingRemaining = (d) =>
    d.amount_cents -
    get(
      "SELECT COALESCE(SUM(amount_cents),0) n FROM opening_allocations WHERE debt_id=?",
      d.id,
    ).n;
  ctx.openingDebt = (e, c) =>
    all(
      "SELECT * FROM opening_debts WHERE entity_id=? AND client_id=?",
      e,
      c,
    ).reduce((s, d) => s + openingRemaining(d), 0);
  const originalBalance = ctx.syncInventory;
  ctx.syncInventory = (e, w, p) => {
    originalBalance(e, w, p);
    run(
      "INSERT INTO stock_days VALUES(?,?,?,?,?) ON CONFLICT(entity_id,warehouse_id,product_id,day) DO UPDATE SET available=excluded.available",
      e,
      w,
      p,
      today(),
      ctx.balance(e, w, p).available,
    );
  };
  ctx.approved = (oid, version, kind) =>
    !!get(
      "SELECT id FROM approvals WHERE order_id=? AND version=? AND kind=? AND status='approved'",
      oid,
      version,
      kind,
    );
  ctx.checkPricePolicy = (u, o) => {
    const creator = get("SELECT roles FROM users WHERE id=?", o.created_by);
    const roles = JSON.parse(creator?.roles || "[]");
    const limits = ctx.setting("discount_limits", {
      seller: 0,
      manager: 0,
      rep: 0,
    });
    const limit = roles.includes("owner")
      ? 100
      : Math.max(0, ...roles.map((r) => limits[r] || 0));
    const floor = ctx.setting("min_margin_percent", 0);
    const reasons = [];
    for (const l of o.lines) {
      if (!l.promotion_id && l.discount_percent > limit)
        reasons.push("Скидка превышает лимит сотрудника");
      const cost = ctx.balance(
        o.entity_id,
        o.warehouse_id,
        l.product_id,
      ).cost_cents;
      if (
        floor > 0 &&
        (cost == null ||
          l.unit_price_cents === 0 ||
          ((l.unit_price_cents - cost) * 100) / l.unit_price_cents < floor)
      )
        reasons.push("Не подтверждена минимальная маржа");
    }
    if (reasons.length && !ctx.approved(o.id, o.version, "price"))
      bad(
        [...new Set(reasons)].join(". ") +
          ". Запросите согласование владельца.",
        409,
      );
  };

  const importRows = (user, b, preview) => {
    requireRole(user, "accountant");
    scope(user, b.entity_id, b.warehouse_id);
    if (
      !["clients", "balances", "debts", "prices"].includes(b.kind) ||
      !Array.isArray(b.rows) ||
      !b.rows.length ||
      b.rows.length > 2000
    )
      bad("Выберите тип и от 1 до 2000 строк");
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: b.kind,
          entity_id: b.entity_id,
          warehouse_id: b.warehouse_id,
          rows: b.rows,
        }),
      )
      .digest("hex");
    if (!preview && b.preview_hash !== hash)
      bad("Повторите предварительную проверку", 409);
    const errors = [],
      seen = new Set();
    run("SAVEPOINT import_all");
    try {
      for (let i = 0; i < b.rows.length; i++) {
        run("SAVEPOINT import_row");
        try {
          const r = b.rows[i];
          if (!r || typeof r !== "object") bad("Некорректная строка");
          const key =
            b.kind === "clients"
              ? r.inn || r.phone || r.name
              : b.kind === "debts"
                ? r.client_id + ":" + r.reason
                : r.sku;
          if (seen.has(key)) bad("Дублирующаяся строка");
          seen.add(key);
          if (b.kind === "clients") {
            if (
              get(
                "SELECT id FROM clients WHERE (inn<>'' AND inn=?) OR (phone<>'' AND phone=?) OR name=?",
                String(r.inn || ""),
                String(r.phone || ""),
                String(r.name || ""),
              )
            )
              bad("Такой клиент уже есть");
            ctx.dispatch("POST", "/clients", {
              user,
              body: {
                name: r.name,
                kind: r.kind || "customer",
                phone: r.phone || "",
                inn: r.inn || "",
                address: r.address || "",
                email: r.email || "",
              },
            });
          } else if (b.kind === "debts") {
            ctx.dispatch("POST", "/opening-debts", {
              user,
              body: {
                ...r,
                entity_id: b.entity_id,
                amount_cents: Number(r.amount_cents),
              },
            });
          } else {
            const p = get("SELECT * FROM products WHERE sku=?", String(r.sku));
            if (!p) bad("Артикул не найден");
            if (b.kind === "prices") {
              requireRole(user, "owner");
              const retail = integer(Number(r.retail_cents), "розничная цена"),
                wholesale = integer(Number(r.wholesale_cents), "оптовая цена");
              run(
                "UPDATE products SET retail_cents=?,wholesale_cents=? WHERE id=?",
                retail,
                wholesale,
                p.id,
              );
            } else
              ctx.stockReceive(user, {
                entity_id: b.entity_id,
                warehouse_id: b.warehouse_id,
                product_id: p.id,
                qty: Number(r.qty),
                cost_cents:
                  r.cost_cents === "" || r.cost_cents == null
                    ? null
                    : Number(r.cost_cents),
                expires_at: r.expires_at || null,
                batch_number: r.batch_number || "",
                reason: str(r.reason, "основание", true),
              });
          }
          run("RELEASE import_row");
        } catch (e) {
          run("ROLLBACK TO import_row");
          run("RELEASE import_row");
          errors.push({
            row: i + 2,
            error: e.status ? e.message : "Проверьте данные строки",
          });
        }
      }
      if (preview || errors.length) run("ROLLBACK TO import_all");
      run("RELEASE import_all");
    } catch (e) {
      run("ROLLBACK TO import_all");
      run("RELEASE import_all");
      throw e;
    }
    if (!preview && errors.length)
      bad(
        "Импорт отменён: " +
          errors.map((e) => e.row + ": " + e.error).join("; "),
      );
    if (!preview)
      audit(user, "import." + b.kind, "import", id(), {
        entity_id: b.entity_id,
        count: b.rows.length,
      });
    return { preview_hash: hash, errors, count: b.rows.length };
  };
  add("POST", "/imports/preview", ({ user, body }) =>
    importRows(user, body, true),
  );
  add("POST", "/imports/commit", ({ user, body }) =>
    importRows(user, body, false),
  );
  add("GET", "/purchases", ({ user, query }) => {
    requireRole(user, "accountant", "warehouse");
    return all("SELECT * FROM purchases ORDER BY created_at DESC")
      .filter(
        (p) =>
          visible(user, p.entity_id, p.warehouse_id) &&
          (!query.entity_id || query.entity_id === p.entity_id),
      )
      .map((p) => ({
        ...p,
        lines: all(
          "SELECT * FROM purchase_lines WHERE purchase_id=?",
          p.id,
        ).map((l) => {
          const result = { ...l, received_qty: received(l.id) };
          if (!finance(user)) delete result.cost_cents;
          return result;
        }),
        receipts: all(
          "SELECT * FROM purchase_receipts WHERE purchase_id=? ORDER BY created_at",
          p.id,
        ),
      }));
  });
  add("POST", "/purchases/:id/receive", ({ user, params, body: b }) =>
    tx(() => {
      const p = purchase(user, params.id);
      if (!["ordered", "partially_received"].includes(p.status))
        bad("Закупка закрыта", 409);
      const lines = all(
        "SELECT * FROM purchase_lines WHERE purchase_id=?",
        p.id,
      );
      const entries =
        b.lines ??
        lines
          .map((l) => ({ line_id: l.id, qty: l.qty - received(l.id) }))
          .filter((l) => l.qty > 0);
      if (!Array.isArray(entries) || !entries.length || entries.length > 1000)
        bad("Укажите принимаемые позиции");
      const seen = new Set();
      let total = 0;
      for (const x of entries) {
        const l = lines.find((l) => l.id === x.line_id);
        if (!l || seen.has(l.id)) bad("Некорректная строка закупки");
        seen.add(l.id);
        integer(x.qty, "принято", 1);
        if (x.qty > l.qty - received(l.id))
          bad("Количество превышает остаток заказа");
        const quarantine = !!x.quarantine;
        const reason = str(x.reason, "причина расхождения", quarantine);
        const result = ctx.stockReceive(user, {
          ...p,
          product_id: l.product_id,
          qty: x.qty,
          cost_cents: l.cost_cents,
          supplier_id: p.supplier_id,
          batch_number: x.batch_number ?? l.batch_number,
          expires_at: x.expires_at ?? l.expires_at,
          quarantine,
          reason: "Приёмка закупки " + p.id + (reason ? ": " + reason : ""),
        });
        run(
          "INSERT INTO purchase_receipts VALUES(?,?,?,?,?,?,?,?,?)",
          id(),
          p.id,
          l.id,
          result.batch_id,
          x.qty,
          quarantine ? 1 : 0,
          reason,
          user.id,
          now(),
        );
        total += x.qty * l.cost_cents;
      }
      if (p.supplier_id)
        ledger(
          user,
          p.entity_id,
          p.supplier_id,
          "receipt",
          total,
          p.id,
          str(b.reason, "основание") || "Приёмка поставки",
          day(b.due_date),
        );
      const complete = lines.every((l) => received(l.id) === l.qty);
      run(
        "UPDATE purchases SET status=?,received_at=? WHERE id=?",
        complete ? "received" : "partially_received",
        now(),
        p.id,
      );
      audit(user, "purchase.receive", "purchase", p.id, {
        entity_id: p.entity_id,
        lines: entries,
        total_cents: total,
      });
      return get("SELECT * FROM purchases WHERE id=?", p.id);
    }),
  );
  add("POST", "/purchases/:id/close", ({ user, params, body }) =>
    tx(() => {
      requireRole(user, "accountant");
      const p = purchase(user, params.id);
      if (!["ordered", "partially_received"].includes(p.status))
        bad("Закупка уже закрыта", 409);
      const reason = str(body.reason, "причина закрытия", true);
      run(
        "UPDATE purchases SET status='closed',notes=notes||? WHERE id=?",
        "\nЗакрытие: " + reason,
        p.id,
      );
      audit(user, "purchase.close", "purchase", p.id, {
        entity_id: p.entity_id,
        reason,
      });
      return { ok: true };
    }),
  );
  add("GET", "/stock/batches", ({ user, query: q }) => {
    requireRole(user, "warehouse", "accountant");
    scope(user, q.entity_id, q.warehouse_id);
    return all(
      "SELECT b.*,p.name,p.sku FROM stock_batches b JOIN products p ON p.id=b.product_id WHERE b.entity_id=? AND b.warehouse_id=? AND (b.qty>0 OR b.quarantine>0)",
      q.entity_id,
      q.warehouse_id,
    ).map((b) => {
      if (!finance(user)) delete b.cost_cents;
      return b;
    });
  });
  add("POST", "/supplier-returns", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "accountant");
      const batch = get("SELECT * FROM stock_batches WHERE id=?", b.batch_id);
      if (!batch) bad("Партия не найдена", 404);
      scope(user, batch.entity_id, batch.warehouse_id);
      if (!batch.supplier_id || batch.cost_cents == null)
        bad("Для возврата нужны поставщик и стоимость партии");
      integer(b.qty, "количество", 1);
      const reason = str(b.reason, "основание", true);
      const field = b.quarantine ? "quarantine" : "qty";
      if (b.qty > batch[field] - (b.quarantine ? 0 : batch.reserved))
        bad("Недостаточно незарезервированного товара", 409);
      run(
        `UPDATE stock_batches SET ${field}=${field}-? WHERE id=?`,
        b.qty,
        batch.id,
      );
      const mid = ctx.movement(user, batch, -b.qty, "supplier_return", reason);
      ctx.syncInventory(batch.entity_id, batch.warehouse_id, batch.product_id);
      ledger(
        user,
        batch.entity_id,
        batch.supplier_id,
        "return",
        -b.qty * batch.cost_cents,
        mid,
        reason,
      );
      audit(user, "supplier.return", "stock", mid, {
        entity_id: batch.entity_id,
        batch_id: batch.id,
        qty: b.qty,
      });
      return { id: mid };
    }),
  );
  add("GET", "/supplier-ledger", ({ user, query: q }) => {
    requireRole(user, "accountant");
    scope(user, q.entity_id);
    return all(
      "SELECT s.*,c.name supplier_name,u.name actor_name FROM supplier_ledger s JOIN clients c ON c.id=s.supplier_id JOIN users u ON u.id=s.actor_id WHERE s.entity_id=? ORDER BY s.created_at DESC",
      q.entity_id,
    );
  });
  add("POST", "/supplier-ledger", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "accountant");
      scope(user, b.entity_id);
      const c = client(user, b.supplier_id);
      if (c.kind !== "supplier") bad("Выберите поставщика");
      if (!["opening", "payment", "refund"].includes(b.kind))
        bad("Неизвестная операция");
      integer(b.amount_cents, "сумма", 1);
      const reason = str(b.reason, "основание", true);
      const balance = get(
        "SELECT COALESCE(SUM(amount_cents),0) n FROM supplier_ledger WHERE entity_id=? AND supplier_id=?",
        b.entity_id,
        c.id,
      ).n;
      if (b.kind === "refund" && b.amount_cents > Math.max(0, -balance))
        bad("Возврат превышает аванс поставщику");
      const key = ledger(
        user,
        b.entity_id,
        c.id,
        b.kind,
        b.kind === "payment" ? -b.amount_cents : b.amount_cents,
        null,
        reason,
        day(b.due_date),
      );
      audit(user, "supplier." + b.kind, "supplier_ledger", key, {
        entity_id: b.entity_id,
        amount_cents: b.amount_cents,
      });
      return { id: key };
    }),
  );
  add("GET", "/opening-debts", ({ user, query: q }) => {
    requireRole(user, "accountant", "manager", "rep", "seller");
    scope(user, q.entity_id);
    return all(
      "SELECT d.*,c.name client_name FROM opening_debts d JOIN clients c ON c.id=d.client_id WHERE d.entity_id=? ORDER BY d.created_at DESC",
      q.entity_id,
    )
      .filter((d) =>
        ctx.canClient(
          user,
          get("SELECT * FROM clients WHERE id=?", d.client_id),
        ),
      )
      .map((d) => ({ ...d, remaining_cents: openingRemaining(d) }));
  });
  add("POST", "/opening-debts", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "accountant");
      scope(user, b.entity_id);
      client(user, b.client_id);
      integer(b.amount_cents, "начальный долг", 1);
      const key = id();
      run(
        "INSERT INTO opening_debts VALUES(?,?,?,?,?,?,?,?)",
        key,
        b.entity_id,
        b.client_id,
        b.amount_cents,
        day(b.due_date),
        str(b.reason, "запись блокнота / основание", true),
        user.id,
        now(),
      );
      audit(user, "opening.debt", "opening_debt", key, {
        entity_id: b.entity_id,
        amount_cents: b.amount_cents,
      });
      return { id: key };
    }),
  );
  add("POST", "/opening-debts/:id/pay", ({ user, params, body: b }) =>
    tx(() => {
      requireRole(user, "accountant", "rep", "seller");
      const d = get("SELECT * FROM opening_debts WHERE id=?", params.id);
      if (!d) bad("Начальный долг не найден", 404);
      scope(user, d.entity_id);
      client(user, d.client_id);
      integer(b.amount_cents, "сумма", 1);
      if (b.amount_cents > openingRemaining(d))
        bad("Сумма превышает остаток долга");
      if (!["cash", "bank"].includes(b.method)) bad("Выберите способ оплаты");
      const reference = str(b.reference, "основание", b.method === "bank");
      const pid = id();
      run(
        "INSERT INTO payments(id,entity_id,client_id,amount_cents,method,collected_by,reference,note,created_at,held_in_custody) VALUES(?,?,?,?,?,?,?,?,?,?)",
        pid,
        d.entity_id,
        d.client_id,
        b.amount_cents,
        b.method,
        user.id,
        reference,
        "Погашение начального долга " + d.id,
        now(),
        b.method === "cash" &&
          has(user, "rep", "courier") &&
          !has(user, "owner", "accountant")
          ? 1
          : 0,
      );
      run(
        "INSERT INTO opening_allocations VALUES(?,?,?,?)",
        id(),
        d.id,
        pid,
        b.amount_cents,
      );
      audit(user, "opening.pay", "payment", pid, {
        entity_id: d.entity_id,
        debt_id: d.id,
        amount_cents: b.amount_cents,
      });
      return { id: pid };
    }),
  );
  const snapshot = (e, w) =>
    all(
      "SELECT id,product_id,qty,reserved,quarantine,cost_cents,expires_at FROM stock_batches WHERE entity_id=? AND warehouse_id=? ORDER BY id",
      e,
      w,
    );
  add("GET", "/stocktakes", ({ user, query: q }) => {
    requireRole(user, "warehouse", "accountant");
    scope(user, q.entity_id, q.warehouse_id);
    return all(
      "SELECT * FROM stocktakes WHERE entity_id=? AND warehouse_id=? ORDER BY created_at DESC",
      q.entity_id,
      q.warehouse_id,
    ).map((s) => ({
      ...s,
      snapshot: JSON.parse(s.snapshot).map((b) => {
        if (!finance(user)) delete b.cost_cents;
        return b;
      }),
      counts: JSON.parse(s.counts),
    }));
  });
  add("POST", "/stocktakes", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "warehouse", "accountant");
      scope(user, b.entity_id, b.warehouse_id);
      const sid = id();
      run(
        "INSERT INTO stocktakes VALUES(?,?,?,?,?,?,?,?,?,?)",
        sid,
        b.entity_id,
        b.warehouse_id,
        "draft",
        JSON.stringify(snapshot(b.entity_id, b.warehouse_id)),
        "{}",
        str(b.reason, "основание пересчёта", true),
        user.id,
        now(),
        null,
      );
      audit(user, "stocktake.create", "stocktake", sid, {
        entity_id: b.entity_id,
      });
      return { id: sid };
    }),
  );
  add("POST", "/stocktakes/:id/post", ({ user, params, body: b }) =>
    tx(() => {
      requireRole(user, "accountant");
      const s = get("SELECT * FROM stocktakes WHERE id=?", params.id);
      if (!s) bad("Пересчёт не найден", 404);
      scope(user, s.entity_id, s.warehouse_id);
      if (s.status !== "draft") bad("Пересчёт уже проведён", 409);
      if (JSON.stringify(snapshot(s.entity_id, s.warehouse_id)) !== s.snapshot)
        bad(
          "Остатки изменились после начала пересчёта. Создайте новый снимок.",
          409,
        );
      const batches = JSON.parse(s.snapshot);
      if (
        !b.counts ||
        Array.isArray(b.counts) ||
        typeof b.counts !== "object" ||
        Object.keys(b.counts).length !== batches.length
      )
        bad("Заполните каждую партию");
      for (const batch of batches) {
        const count = b.counts[batch.id];
        if (!count) bad("Не заполнена партия");
        integer(count.qty, "фактический годный остаток");
        integer(count.quarantine, "фактический карантин");
        if (count.qty < batch.reserved)
          bad(
            "Фактический остаток меньше резерва: сначала разберите заказы",
            409,
          );
        const product = get(
          "SELECT * FROM products WHERE id=?",
          batch.product_id,
        );
        if (
          count.qty > batch.qty &&
          (product.marked || (batch.expires_at && batch.expires_at < today()))
        )
          bad(
            "Излишек маркированного/просроченного товара сначала оформите в карантин",
          );
        run(
          "UPDATE stock_batches SET qty=?,quarantine=? WHERE id=?",
          count.qty,
          count.quarantine,
          batch.id,
        );
        const full = {
          ...batch,
          entity_id: s.entity_id,
          warehouse_id: s.warehouse_id,
        };
        if (count.qty !== batch.qty || count.quarantine !== batch.quarantine)
          ctx.movement(
            user,
            full,
            count.qty + count.quarantine - batch.qty - batch.quarantine,
            "stocktake",
            s.reason + " · " + s.id,
          );
        ctx.syncInventory(s.entity_id, s.warehouse_id, batch.product_id);
      }
      run(
        "UPDATE stocktakes SET status='posted',counts=?,posted_at=? WHERE id=?",
        JSON.stringify(b.counts),
        now(),
        s.id,
      );
      audit(user, "stocktake.post", "stocktake", s.id, {
        entity_id: s.entity_id,
        counts: b.counts,
      });
      return { ok: true };
    }),
  );
  add("POST", "/stocktakes/:id/cancel", ({ user, params }) =>
    tx(() => {
      requireRole(user, "accountant", "warehouse");
      const s = get("SELECT * FROM stocktakes WHERE id=?", params.id);
      if (!s) bad("Пересчёт не найден", 404);
      scope(user, s.entity_id, s.warehouse_id);
      if (s.status !== "draft")
        bad("Проведённый пересчёт нельзя отменить", 409);
      run("UPDATE stocktakes SET status='cancelled' WHERE id=?", s.id);
      audit(user, "stocktake.cancel", "stocktake", s.id, {
        entity_id: s.entity_id,
      });
      return { ok: true };
    }),
  );

  add("GET", "/client-prices", ({ user, query: q }) => {
    requireRole(user, "accountant", "manager", "rep", "seller");
    scope(user, q.entity_id);
    return all(
      "SELECT cp.*,c.name client_name,p.name product_name FROM client_prices cp JOIN clients c ON c.id=cp.client_id JOIN products p ON p.id=cp.product_id WHERE entity_id=?",
      q.entity_id,
    ).filter((p) =>
      ctx.canClient(user, get("SELECT * FROM clients WHERE id=?", p.client_id)),
    );
  });
  add("POST", "/client-prices", ({ user, body: b }) =>
    tx(() => {
      requireRole(user, "owner");
      scope(user, b.entity_id);
      client(user, b.client_id);
      integer(b.price_cents, "цена");
      if (!get("SELECT id FROM products WHERE id=?", b.product_id))
        bad("Товар не найден");
      run(
        "INSERT INTO client_prices VALUES(?,?,?,?) ON CONFLICT(entity_id,client_id,product_id) DO UPDATE SET price_cents=excluded.price_cents",
        b.entity_id,
        b.client_id,
        b.product_id,
        b.price_cents,
      );
      audit(user, "price.individual", "client", b.client_id, {
        entity_id: b.entity_id,
        product_id: b.product_id,
        price_cents: b.price_cents,
      });
      return { ok: true };
    }),
  );
  add("POST", "/client-prices/remove", ({ user, body: b }) => {
    requireRole(user, "owner");
    scope(user, b.entity_id);
    run(
      "DELETE FROM client_prices WHERE entity_id=? AND client_id=? AND product_id=?",
      b.entity_id,
      b.client_id,
      b.product_id,
    );
    audit(user, "price.remove", "client", b.client_id, {
      entity_id: b.entity_id,
      product_id: b.product_id,
    });
    return { ok: true };
  });
  add("GET", "/tasks", ({ user, query: q }) => {
    requireRole(
      user,
      "manager",
      "rep",
      "seller",
      "accountant",
      "warehouse",
      "dispatcher",
      "courier",
    );
    scope(user, q.entity_id);
    return all(
      "SELECT t.*,c.name client_name,u.name employee_name FROM tasks t LEFT JOIN clients c ON c.id=t.client_id JOIN users u ON u.id=t.assigned_to WHERE t.entity_id=? ORDER BY t.status,t.due_date",
      q.entity_id,
    ).filter((t) => has(user, "owner") || t.assigned_to === user.id);
  });
  add("POST", "/tasks", ({ user, body: b }) =>
    tx(() => {
      requireRole(
        user,
        "manager",
        "rep",
        "seller",
        "accountant",
        "warehouse",
        "dispatcher",
        "courier",
      );
      scope(user, b.entity_id);
      const assigned = b.assigned_to || user.id;
      if (assigned !== user.id && !has(user, "owner"))
        bad("Можно назначить задачу только себе", 403);
      const employee = get(
        "SELECT * FROM users WHERE id=? AND active=1",
        assigned,
      );
      if (
        !employee ||
        (!JSON.parse(employee.roles).includes("owner") &&
          !JSON.parse(employee.entity_ids).includes(b.entity_id))
      )
        bad("Ответственный недоступен");
      if (b.client_id) {
        client(user, b.client_id);
        if (
          assigned !== user.id &&
          !ctx.canClient(
            { ...employee, roles: JSON.parse(employee.roles) },
            get("SELECT * FROM clients WHERE id=?", b.client_id),
          )
        )
          bad("Ответственный не имеет доступа к клиенту");
      }
      const key = id();
      run(
        "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)",
        key,
        b.entity_id,
        b.client_id || null,
        assigned,
        str(b.title, "задача", true),
        day(b.due_date) || today(),
        "open",
        str(b.note, "заметка"),
        user.id,
        now(),
      );
      audit(user, "task.create", "task", key, { entity_id: b.entity_id });
      return { id: key };
    }),
  );
  add("PATCH", "/tasks/:id", ({ user, params, body: b }) => {
    const t = get("SELECT * FROM tasks WHERE id=?", params.id);
    if (!t) bad("Задача не найдена", 404);
    scope(user, t.entity_id);
    if (!has(user, "owner") && t.assigned_to !== user.id)
      bad("Нет доступа к задаче", 403);
    if (!["open", "done", "cancelled"].includes(b.status))
      bad("Некорректный статус");
    run(
      "UPDATE tasks SET status=?,note=? WHERE id=?",
      b.status,
      str(b.note ?? t.note, "заметка"),
      t.id,
    );
    audit(user, "task.update", "task", t.id, {
      entity_id: t.entity_id,
      status: b.status,
    });
    return { ok: true };
  });
  add("GET", "/approvals", ({ user }) =>
    all(
      "SELECT a.*,o.number FROM approvals a JOIN orders o ON o.id=a.order_id ORDER BY a.created_at DESC",
    ).filter((a) => {
      const o = get("SELECT * FROM orders WHERE id=?", a.order_id);
      try {
        return ctx.canOrder(user, o);
      } catch {
        return false;
      }
    }),
  );
  add("POST", "/orders/:id/approval", ({ user, params, body: b }) => {
    requireRole(user, "seller", "manager", "rep");
    const o = ctx.orderView(user, params.id);
    if (!["price", "credit"].includes(b.kind))
      bad("Неизвестный вид согласования");
    if (!["draft", "confirmed", "partially_shipped"].includes(o.status))
      bad("Заказ закрыт");
    const existing = get(
      "SELECT * FROM approvals WHERE order_id=? AND version=? AND kind=? AND status='pending'",
      o.id,
      o.version,
      b.kind,
    );
    if (existing) return existing;
    const key = id();
    run(
      "INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?)",
      key,
      o.id,
      o.version,
      b.kind,
      "pending",
      str(b.reason, "причина исключения", true),
      user.id,
      null,
      now(),
      null,
    );
    audit(user, "approval.request", "order", o.id, {
      entity_id: o.entity_id,
      kind: b.kind,
    });
    return { id: key };
  });
  add("POST", "/approvals/:id/decide", ({ user, params, body: b }) => {
    requireRole(user, "owner");
    const a = get("SELECT * FROM approvals WHERE id=?", params.id);
    if (!a) bad("Запрос не найден", 404);
    const o = ctx.orderView(user, a.order_id);
    if (a.status !== "pending" || o.version !== a.version)
      bad("Заказ изменён либо решение уже принято", 409);
    if (!["approved", "rejected"].includes(b.status)) bad("Выберите решение");
    run(
      "UPDATE approvals SET status=?,decided_by=?,decided_at=? WHERE id=?",
      b.status,
      user.id,
      now(),
      a.id,
    );
    audit(user, "approval.decide", "order", o.id, {
      entity_id: o.entity_id,
      approval_id: a.id,
      status: b.status,
    });
    return { ok: true };
  });
  add("POST", "/orders/:id/packing", ({ user, params, body: b }) => {
    requireRole(user, "warehouse");
    const o = ctx.orderView(user, params.id);
    if (!["confirmed", "partially_shipped"].includes(o.status))
      bad("Заказ не готов к сборке");
    if (!["picking", "ready"].includes(b.status)) bad("Выберите статус сборки");
    const lines = b.lines || {};
    for (const l of o.lines) {
      integer(lines[l.id] ?? 0, "собрано");
      if ((lines[l.id] ?? 0) > l.qty - l.shipped_qty)
        bad("Собрано больше остатка заказа");
      if (b.status === "ready" && (lines[l.id] ?? 0) !== l.qty - l.shipped_qty)
        bad("Для готовности проверьте все позиции");
    }
    run(
      "INSERT INTO packing VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,lines=excluded.lines,actor_id=excluded.actor_id,updated_at=excluded.updated_at",
      o.id,
      b.status,
      JSON.stringify(lines),
      user.id,
      now(),
    );
    audit(user, "packing.update", "order", o.id, {
      entity_id: o.entity_id,
      status: b.status,
    });
    return { ok: true };
  });
  add("GET", "/orders/:id/packing", ({ user, params }) => {
    ctx.orderView(user, params.id);
    const p = get("SELECT * FROM packing WHERE order_id=?", params.id);
    return p
      ? { ...p, lines: JSON.parse(p.lines) }
      : { status: "not_started", lines: {} };
  });
  add("POST", "/orders/:id/document", ({ user, params, body: b }) => {
    requireRole(user, "seller", "manager", "rep", "accountant");
    const o = ctx.orderView(user, params.id);
    if (!["invoice", "shipment", "details"].includes(b.kind))
      bad("Выберите документ");
    if (b.kind === "shipment" && o.shipped_cents <= o.returned_cents)
      bad("Нет отгруженного товара для документа");
    if (b.kind === "invoice" && o.status === "cancelled")
      bad("По отменённому заказу новый счёт не выставляется");
    const existing = get(
      "SELECT * FROM document_snapshots WHERE order_id=? AND version=? AND kind=?",
      o.id,
      o.version,
      b.kind,
    );
    if (existing) return { ...existing, content: JSON.parse(existing.content) };
    const content = {
      order: { ...o, lines: o.lines.map(({ cost_cents, ...line }) => line) },
      entity: get("SELECT * FROM entities WHERE id=?", o.entity_id),
      client: o.client_id
        ? get("SELECT * FROM clients WHERE id=?", o.client_id)
        : null,
    };
    if (b.kind === "shipment") {
      content.order.lines = content.order.lines
        .filter((l) => l.shipped_qty > l.returned_qty)
        .map((l) => ({
          ...l,
          qty: l.shipped_qty - l.returned_qty,
          line_total_cents:
            (l.shipped_qty - l.returned_qty) * l.unit_price_cents,
        }));
      content.order.total_cents = o.shipped_cents - o.returned_cents;
    }
    const key = id();
    run(
      "INSERT INTO document_snapshots VALUES(?,?,?,?,?,?,?)",
      key,
      o.id,
      o.version,
      b.kind,
      JSON.stringify(content),
      user.id,
      now(),
    );
    audit(user, "document.create", "order", o.id, {
      entity_id: o.entity_id,
      document_id: key,
      kind: b.kind,
    });
    return { id: key, kind: b.kind, created_at: now(), content };
  });

  add("GET", "/purchase-suggestions", ({ user, query: q }) => {
    requireRole(user, "accountant");
    scope(user, q.entity_id, q.warehouse_id);
    const days = integer(Number(q.days || 30), "период", 1),
      lead = integer(Number(q.lead || 7), "срок поставки", 1);
    if (days > 365 || lead > 365) bad("Период до 365 дней");
    const from = new Date(Date.parse(now()) - days * 86400000).toISOString();
    return all("SELECT * FROM products WHERE active=1")
      .map((p) => {
        const balance = ctx.balance(q.entity_id, q.warehouse_id, p.id);
        const sales = get(
          "SELECT COALESCE(SUM(-qty),0) n FROM stock_movements WHERE entity_id=? AND warehouse_id=? AND product_id=? AND kind IN ('ship','return') AND created_at>=?",
          q.entity_id,
          q.warehouse_id,
          p.id,
          from,
        ).n;
        const expected = all(
          "SELECT l.* FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id WHERE p.entity_id=? AND p.warehouse_id=? AND l.product_id=? AND p.status IN ('ordered','partially_received')",
          q.entity_id,
          q.warehouse_id,
          p.id,
        ).reduce((n, l) => n + l.qty - received(l.id), 0);
        const target = Math.max(
          p.min_stock,
          Math.ceil((Math.max(0, sales) / days) * lead),
        );
        const qty =
          Math.ceil(
            Math.max(0, target - balance.available - expected) / p.pack_size,
          ) * p.pack_size;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          available: balance.available,
          reserved: balance.reserved,
          expected,
          sold: Math.max(0, sales),
          target,
          pack_size: p.pack_size,
          qty,
          days,
          lead,
          note:
            sales === 0
              ? "Нет продаж за период: расчёт по минимальному остатку"
              : "Продажи могут быть занижены при отсутствии товара",
        };
      })
      .filter((p) => p.qty > 0);
  });
  add("GET", "/reports/detail", ({ user, query: q }) => {
    requireRole(user, "accountant");
    scope(user, q.entity_id);
    const from = day(q.from) || today(),
      to = day(q.to) || today();
    if (from > to) bad("Начало позже окончания");
    const begin = from + "T00:00:00+04:00",
      end = new Date(
        Date.parse(to + "T00:00:00+04:00") + 86400000,
      ).toISOString();
    const movements = all(
      "SELECT m.*,o.number,o.client_id,o.created_by,c.name client_name,u.name employee_name,p.name product_name,p.category,p.brand,q.promotion_id FROM stock_movements m JOIN orders o ON o.id=m.order_id LEFT JOIN clients c ON c.id=o.client_id JOIN users u ON u.id=o.created_by JOIN products p ON p.id=m.product_id LEFT JOIN line_quotes q ON q.line_id=m.order_line_id WHERE m.entity_id=? AND m.kind IN ('ship','return') AND m.created_at>=? AND m.created_at<?",
      q.entity_id,
      new Date(begin).toISOString(),
      end,
    );
    const groups = (key) => {
      const map = new Map();
      for (const m of movements) {
        const name =
          key === "client_name"
            ? m.client_name || "Розница без клиента"
            : key === "promotion_id"
              ? m.promotion_id || "Без акции"
              : m[key] || "Не указано";
        const identity =
          {
            product_name: m.product_id,
            client_name: m.client_id || "anonymous",
            employee_name: m.created_by,
            promotion_id: m.promotion_id || "none",
          }[key] || name;
        let g = map.get(identity);
        if (!g) {
          g = {
            id: identity,
            name,
            qty: 0,
            sales_cents: 0,
            cost_cents: 0,
            documents: [],
            order_ids: [],
          };
          map.set(identity, g);
        }
        g.qty -= m.qty;
        g.sales_cents =
          m.revenue_cents == null || g.sales_cents == null
            ? null
            : g.sales_cents + m.revenue_cents;
        g.cost_cents =
          m.cost_cents == null || g.cost_cents == null
            ? null
            : g.cost_cents - m.qty * m.cost_cents;
        g.documents.push(m);
        if (!g.order_ids.includes(m.order_id)) g.order_ids.push(m.order_id);
      }
      return [...map.values()].map((g) => ({
        ...g,
        orders: g.order_ids.length,
        average_cents:
          g.order_ids.length && g.sales_cents != null
            ? Math.round(g.sales_cents / g.order_ids.length)
            : null,
        gross_profit_cents:
          g.sales_cents == null || g.cost_cents == null
            ? null
            : g.sales_cents - g.cost_cents,
      }));
    };
    return {
      from,
      to,
      products: groups("product_name"),
      categories: groups("category"),
      brands: groups("brand"),
      clients: groups("client_name"),
      employees: groups("employee_name"),
      promotions: groups("promotion_id"),
      documents: movements,
      note: "Продажи и возвраты по дате движения, суммы в копейках. Результат отнесён только автору заказа, без двойного счёта. Неизвестная себестоимость не заменяется нулём.",
    };
  });
  add("GET", "/attention", ({ user, query: q }) => {
    requireRole(user, "accountant");
    scope(user, q.entity_id);
    const result = [];
    const push = (id, title, detail, page, owner = null) =>
      result.push({ id, title, detail, page, owner });
    for (const d of all(
      "SELECT o.*,c.name client_name FROM orders o LEFT JOIN clients c ON c.id=o.client_id WHERE o.entity_id=?",
      q.entity_id,
    )) {
      const due = Math.max(
        0,
        d.shipped_cents - d.returned_cents - d.paid_cents + d.refunded_cents,
      );
      if (d.due_date && d.due_date < today() && due > 0)
        push(
          "debt-" + d.id,
          "Просрочена оплата",
          `${d.number}: ${due / 100} ₽, срок ${d.due_date}`,
          "orders",
          d.created_by,
        );
      if (
        ["confirmed", "partially_shipped"].includes(d.status) &&
        Date.parse(d.updated_at) < Date.parse(now()) - 2 * 86400000
      )
        push(
          "order-" + d.id,
          "Заказ ждёт отгрузки",
          `${d.number}: без изменений более 2 дней`,
          "orders",
          d.created_by,
        );
    }
    for (const b of all(
      "SELECT b.*,p.name FROM stock_batches b JOIN products p ON p.id=b.product_id WHERE b.entity_id=? AND b.qty>0",
      q.entity_id,
    )) {
      if (
        b.expires_at &&
        b.expires_at <=
          new Date(Date.parse(now()) + 30 * 86400000).toISOString().slice(0, 10)
      )
        push(
          "expiry-" + b.id,
          "Проверьте срок годности",
          `${b.name}: ${b.qty} шт., срок ${b.expires_at}`,
          "stock",
        );
      const m = get(
        "SELECT MAX(created_at) last FROM stock_movements WHERE entity_id=? AND product_id=? AND kind='ship'",
        q.entity_id,
        b.product_id,
      );
      if (
        Date.parse(m.last || b.created_at) <
        Date.parse(now()) - 60 * 86400000
      )
        push(
          "stale-" + b.id,
          "Остаток без отгрузок 60 дней",
          `${b.name}: ${b.qty} шт. Это не оценка спроса.`,
          "stock",
        );
    }
    for (const a of all(
      "SELECT a.*,o.number FROM approvals a JOIN orders o ON o.id=a.order_id WHERE o.entity_id=? AND a.status='pending' AND a.version=o.version",
      q.entity_id,
    ))
      push(
        "approval-" + a.id,
        "Нужно согласование",
        a.number + ": " + a.reason,
        "orders",
      );
    for (const t of all(
      "SELECT * FROM tasks WHERE entity_id=? AND status='open' AND due_date<=?",
      q.entity_id,
      today(),
    ))
      push(
        "task-" + t.id,
        "Задача к выполнению",
        t.title + " · " + t.due_date,
        "home",
        t.assigned_to,
      );
    return result;
  });

  add("GET", "/products/:id/photo", ({ user, params }) => {
    requireRole(user, "seller", "manager", "rep", "accountant", "warehouse");
    return (
      get(
        "SELECT image,updated_at FROM product_photos WHERE product_id=?",
        params.id,
      ) || { image: null }
    );
  });
  add("POST", "/products/:id/photo", ({ user, params, body: b }) => {
    requireRole(user, "owner");
    if (!get("SELECT id FROM products WHERE id=?", params.id))
      bad("Товар не найден", 404);
    if (b.image === null)
      run("DELETE FROM product_photos WHERE product_id=?", params.id);
    else {
      if (
        typeof b.image !== "string" ||
        b.image.length > 600000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image)
      )
        bad("Фото JPG, PNG или WebP до 400 КБ");
      const bytes = Buffer.from(b.image.split(",")[1], "base64");
      if (bytes.length > 409600 || bytes.length < 12)
        bad("Некорректный размер фото");
      const png = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        webp =
          bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP";
      if (
        !(
          (b.image.startsWith("data:image/png;") && png) ||
          (b.image.startsWith("data:image/jpeg;") && jpg) ||
          (b.image.startsWith("data:image/webp;") && webp)
        )
      )
        bad("Файл не соответствует формату изображения");
      run(
        "INSERT INTO product_photos VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET image=excluded.image,updated_at=excluded.updated_at",
        params.id,
        b.image,
        now(),
      );
    }
    audit(user, "product.photo", "product", params.id, {
      removed: b.image === null,
    });
    return { ok: true };
  });
  ctx.refreshDigest = () =>
    tx(() => {
      if (ctx.setting("digest_enabled", true) === false) return;
      const local = new Date(Date.parse(now()) + 4 * 3600000);
      if (local.getUTCHours() < ctx.setting("digest_hour", 9)) return;
      const day = today(),
        end = Date.parse(day + "T00:00:00+04:00"),
        start = end - 86400000;
      for (const e of all("SELECT id FROM entities")) {
        if (
          get(
            "SELECT id FROM owner_digests WHERE entity_id=? AND day=?",
            e.id,
            day,
          )
        )
          continue;
        const movements = all(
          "SELECT * FROM stock_movements WHERE entity_id=? AND kind IN ('ship','return') AND created_at>=? AND created_at<?",
          e.id,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
        );
        const unknown = movements.some(
          (m) => m.cost_cents == null || m.revenue_cents == null,
        );
        const payload = {
          period_from: new Date(start + 4 * 3600000).toISOString().slice(0, 10),
          sales_cents: movements.some((m) => m.revenue_cents == null)
            ? null
            : movements.reduce((n, m) => n + m.revenue_cents, 0),
          gross_profit_cents: unknown
            ? null
            : movements.reduce(
                (n, m) => n + m.revenue_cents + m.qty * m.cost_cents,
                0,
              ),
          receipts_cents: get(
            "SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE entity_id=? AND created_at>=? AND created_at<?",
            e.id,
            new Date(start).toISOString(),
            new Date(end).toISOString(),
          ).n,
          low_stock: get(
            "SELECT COUNT(*) n FROM alerts WHERE entity_id=? AND status='open'",
            e.id,
          ).n,
        };
        run(
          "INSERT INTO owner_digests VALUES(?,?,?,?,?)",
          id(),
          e.id,
          day,
          JSON.stringify(payload),
          now(),
        );
      }
    });
  add("GET", "/owner-digests", ({ user, query: q }) => {
    requireRole(user, "owner");
    scope(user, q.entity_id);
    ctx.refreshDigest();
    return all(
      "SELECT * FROM owner_digests WHERE entity_id=? ORDER BY day DESC LIMIT 31",
      q.entity_id,
    ).map((d) => ({ ...d, ...JSON.parse(d.payload) }));
  });
  add("GET", "/user-permissions", ({ user }) => {
    requireRole(user, "owner");
    return all(
      "SELECT u.id,u.name,u.roles,p.permissions FROM users u LEFT JOIN user_permissions p ON p.user_id=u.id WHERE u.active=1",
    ).map((u) => ({
      ...u,
      roles: JSON.parse(u.roles),
      permissions: JSON.parse(u.permissions || "{}"),
    }));
  });
  add("POST", "/user-permissions", ({ user, body: b }) => {
    requireRole(user, "owner");
    const u = get("SELECT * FROM users WHERE id=?", b.user_id);
    if (!u) bad("Сотрудник не найден");
    if (JSON.parse(u.roles).includes("owner"))
      bad("Права владельца не ограничиваются");
    const allowed = [
      "view_cost",
      "view_other_clients",
      "change_prices",
      "manual_discount",
      "writeoff",
      "returns",
      "export_data",
    ];
    if (
      !b.permissions ||
      typeof b.permissions !== "object" ||
      Array.isArray(b.permissions)
    )
      bad("Укажите права");
    for (const [k, v] of Object.entries(b.permissions))
      if (!allowed.includes(k) || typeof v !== "boolean")
        bad("Неизвестное право");
    run(
      "INSERT INTO user_permissions VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET permissions=excluded.permissions",
      u.id,
      JSON.stringify(b.permissions),
    );
    audit(user, "permissions.update", "user", u.id, b.permissions);
    return { ok: true };
  });
  add("GET", "/plans", ({ user, query: q }) => {
    requireRole(user, "accountant", "rep", "manager", "seller");
    scope(user, q.entity_id);
    return all(
      "SELECT p.*,u.name employee_name FROM sales_plans p LEFT JOIN users u ON u.id=p.user_id WHERE p.entity_id=? ORDER BY starts_at DESC",
      q.entity_id,
    )
      .filter((p) => has(user, "owner", "accountant") || p.user_id === user.id)
      .map((p) => ({
        ...p,
        actual_cents: get(
          "SELECT COALESCE(SUM(m.revenue_cents),0) n FROM stock_movements m JOIN orders o ON o.id=m.order_id WHERE m.entity_id=? AND (? IS NULL OR o.created_by=?) AND m.kind IN ('ship','return') AND m.created_at>=? AND m.created_at<?",
          p.entity_id,
          p.user_id,
          p.user_id,
          new Date(p.starts_at + "T00:00:00+04:00").toISOString(),
          new Date(
            Date.parse(p.ends_at + "T00:00:00+04:00") + 86400000,
          ).toISOString(),
        ).n,
      }));
  });
  add("POST", "/plans", ({ user, body: b }) => {
    requireRole(user, "owner");
    scope(user, b.entity_id);
    integer(b.amount_cents, "план", 1);
    const start = day(b.starts_at),
      end = day(b.ends_at);
    if (!start || !end || start > end) bad("Проверьте период");
    if (b.user_id) {
      const u = get("SELECT * FROM users WHERE id=? AND active=1", b.user_id);
      if (
        !u ||
        (!JSON.parse(u.roles).includes("owner") &&
          !JSON.parse(u.entity_ids).includes(b.entity_id))
      )
        bad("Сотрудник недоступен");
    }
    if (
      get(
        "SELECT id FROM sales_plans WHERE entity_id=? AND user_id IS ? AND starts_at<=? AND ends_at>=?",
        b.entity_id,
        b.user_id || null,
        end,
        start,
      )
    )
      bad("Для этого ответственного уже есть план на пересекающийся период");
    const key = id();
    run(
      "INSERT INTO sales_plans VALUES(?,?,?,?,?,?,?,?)",
      key,
      b.entity_id,
      b.user_id || null,
      start,
      end,
      b.amount_cents,
      user.id,
      now(),
    );
    audit(user, "plan.create", "plan", key, { entity_id: b.entity_id });
    return { id: key };
  });
  add("GET", "/reports/operations", ({ user, query: q }) => {
    requireRole(user, "accountant");
    scope(user, q.entity_id);
    const from = day(q.from) || today(),
      to = day(q.to) || today();
    if (from > to) bad("Проверьте период");
    const begin = Date.parse(from + "T00:00:00+04:00"),
      end = Date.parse(to + "T00:00:00+04:00") + 86400000,
      span = end - begin;
    const sumPeriod = (a, b) => {
      const rows = all(
        "SELECT m.* FROM stock_movements m WHERE entity_id=? AND kind IN ('ship','return') AND created_at>=? AND created_at<?",
        q.entity_id,
        new Date(a).toISOString(),
        new Date(b).toISOString(),
      );
      return {
        sales_cents: rows.some((r) => r.revenue_cents == null)
          ? null
          : rows.reduce((n, r) => n + r.revenue_cents, 0),
        gross_profit_cents: rows.some(
          (r) => r.cost_cents == null || r.revenue_cents == null,
        )
          ? null
          : rows.reduce(
              (n, r) => n + r.revenue_cents + r.qty * r.cost_cents,
              0,
            ),
        documents: rows,
      };
    };
    const customers = all(
      "SELECT c.* FROM clients c WHERE c.kind<>'supplier'",
    ).map((c) => {
      const orders = all(
        "SELECT * FROM orders WHERE entity_id=? AND client_id=? AND shipped_cents>returned_cents ORDER BY created_at",
        q.entity_id,
        c.id,
      );
      const recent = orders.filter(
        (o) =>
          Date.parse(o.created_at) >= begin && Date.parse(o.created_at) < end,
      );
      let interval = null;
      if (orders.length >= 3)
        interval =
          (Date.parse(orders.at(-1).created_at) -
            Date.parse(orders[0].created_at)) /
          (orders.length - 1) /
          86400000;
      const last = orders.at(-1)?.created_at;
      return {
        id: c.id,
        name: c.name,
        orders: orders.length,
        period_orders: recent.length,
        last_purchase: last,
        average_cents: orders.length
          ? Math.round(
              orders.reduce(
                (n, o) => n + o.shipped_cents - o.returned_cents,
                0,
              ) / orders.length,
            )
          : null,
        interval_days: interval == null ? null : Math.round(interval * 10) / 10,
        late:
          interval != null &&
          interval >= 1 &&
          Date.parse(last) + interval * 1.5 * 86400000 < Date.parse(now()),
        debt_cents:
          orders.reduce(
            (n, o) =>
              n +
              Math.max(
                0,
                o.shipped_cents -
                  o.returned_cents -
                  o.paid_cents +
                  o.refunded_cents,
              ),
            0,
          ) + ctx.openingDebt(q.entity_id, c.id),
      };
    });
    const inventory = all(
      "SELECT i.*,p.name,p.min_stock FROM inventory i JOIN products p ON p.id=i.product_id WHERE i.entity_id=?",
      q.entity_id,
    ).map((i) => {
      const moves = all(
        "SELECT * FROM stock_movements WHERE entity_id=? AND warehouse_id=? AND product_id=? AND kind IN ('ship','return') AND created_at>=? AND created_at<?",
        i.entity_id,
        i.warehouse_id,
        i.product_id,
        new Date(begin).toISOString(),
        new Date(end).toISOString(),
      );
      const sold = moves.reduce((n, m) => n - m.qty, 0);
      const last = get(
        "SELECT MAX(created_at) last FROM stock_movements WHERE entity_id=? AND warehouse_id=? AND product_id=? AND kind='ship'",
        i.entity_id,
        i.warehouse_id,
        i.product_id,
      ).last;
      const observed = all(
        "SELECT day,available FROM stock_days WHERE entity_id=? AND warehouse_id=? AND product_id=? AND day>=? AND day<=?",
        i.entity_id,
        i.warehouse_id,
        i.product_id,
        from,
        to,
      );
      const b = ctx.balance(i.entity_id, i.warehouse_id, i.product_id);
      return {
        id: i.warehouse_id + ":" + i.product_id,
        name: i.name,
        warehouse_id: i.warehouse_id,
        available: b.available,
        reserved: b.reserved,
        on_hand: b.on_hand,
        sold,
        last_shipment: last,
        days_cover:
          sold > 0
            ? Math.round(b.available / (sold / (span / 86400000)))
            : null,
        observed_days: observed.length,
        observed_zero_days: observed.filter((d) => d.available === 0).length,
      };
    });
    const deliveries = all(
      "SELECT d.*,x.deadline_at,x.fee_cents,x.cost_cents,x.delivered_at,o.number,o.entity_id,u.name courier_name FROM deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN delivery_details x ON x.delivery_id=d.id LEFT JOIN users u ON u.id=d.courier_id WHERE o.entity_id=? AND d.created_at>=? AND d.created_at<?",
      q.entity_id,
      new Date(begin).toISOString(),
      new Date(end).toISOString(),
    ).map((d) => ({
      ...d,
      late: d.deadline_at
        ? Date.parse(d.delivered_at || now()) > Date.parse(d.deadline_at)
        : null,
    }));
    return {
      from,
      to,
      current: sumPeriod(begin, end),
      previous: sumPeriod(begin - span, begin),
      customers,
      inventory,
      deliveries,
      stock_note:
        "Дни без остатка показываются только по наблюдаемым дням после запуска учёта. Покрытие = текущий доступный запас / средние продажи за период, не доказательство спроса.",
    };
  });
  add("GET", "/delivery-details", ({ user, query: q }) => {
    requireRole(user, "dispatcher", "courier");
    scope(user, q.entity_id);
    return all(
      "SELECT d.id,d.courier_id,o.number,x.* FROM deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN delivery_details x ON x.delivery_id=d.id WHERE o.entity_id=?",
      q.entity_id,
    )
      .filter((d) => has(user, "dispatcher") || d.courier_id === user.id)
      .map((d) => {
        if (!finance(user)) delete d.cost_cents;
        return d;
      });
  });
  add("POST", "/deliveries/:id/details", ({ user, params, body: b }) => {
    requireRole(user, "dispatcher");
    const d = get(
      "SELECT d.*,o.entity_id,o.warehouse_id FROM deliveries d JOIN orders o ON o.id=d.order_id WHERE d.id=?",
      params.id,
    );
    if (!d) bad("Доставка не найдена", 404);
    scope(user, d.entity_id, d.warehouse_id);
    const old = get("SELECT * FROM delivery_details WHERE delivery_id=?", d.id);
    const deadline = b.deadline_at ? new Date(b.deadline_at) : null;
    if (deadline && !Number.isFinite(deadline.getTime()))
      bad("Проверьте срок доставки");
    integer(b.fee_cents ?? 0, "стоимость доставки");
    if (b.cost_cents !== undefined) requireRole(user, "accountant");
    integer(b.cost_cents ?? old?.cost_cents ?? 0, "расходы");
    run(
      "INSERT INTO delivery_details VALUES(?,?,?,?,?) ON CONFLICT(delivery_id) DO UPDATE SET deadline_at=excluded.deadline_at,fee_cents=excluded.fee_cents,cost_cents=excluded.cost_cents",
      d.id,
      deadline?.toISOString() || null,
      b.fee_cents ?? 0,
      b.cost_cents ?? old?.cost_cents ?? 0,
      old?.delivered_at || null,
    );
    audit(user, "delivery.details", "delivery", d.id, {
      entity_id: d.entity_id,
    });
    return { ok: true };
  });
}
