import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Printer, Copy } from "lucide-react";
import { useCRM } from "./App.jsx";
import { api, money, date, labelStatus } from "./api.js";
import {
  Button,
  Panel,
  PageHeading,
  Table,
  SearchBox,
  Drawer,
  Select,
  Field,
  Badge,
  RecordForm,
  Empty,
} from "./ui.jsx";
import { PaymentForm } from "./Operations.jsx";
export function Orders() {
  const c = useCRM(),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [editor, setEditor] = useState(null),
    [selected, setSelected] = useState(null),
    [error, setError] = useState("");
  async function open(order) {
    try {
      setSelected(await api("/orders/" + order.id));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    const target = c.navigationTarget;
    if (!target) return;
    if (target.new) setEditor({});
    else if (target.id) open({ id: target.id });
    if (target.q) setSearch(target.q);
  }, [c.navigationTarget?.key]);
  const rows = (c.data.orders || []).filter(
    (x) =>
      (!status || x.status === status) &&
      (String(x.number) + " " + (x.client_name || ""))
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sell = c.meta.permissions.can_sell;
  const financial = c.has("seller", "manager", "rep", "accountant");
  return (
    <>
      <PageHeading>
        <div>
          <h1>
            {c.auth.roles.includes("seller") ? "Продажи и касса" : "Продажи"}
          </h1>
          <p>Заказы, резервы и выполнение. Оплата учитывается отдельно.</p>
        </div>
        {sell && (
          <Button primary onClick={() => setEditor({})}>
            <Plus size={17} />
            Новая продажа
          </Button>
        )}
      </PageHeading>
      {error && <div className="error-box">{error}</div>}
      <Panel>
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Номер заказа или клиент"
          />
          <select
            aria-label="Статус заказа"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Все статусы</option>
            {[
              "draft",
              "confirmed",
              "partially_shipped",
              "shipped",
              "cancelled",
            ].map((x) => (
              <option key={x} value={x}>
                {labelStatus(x)}
              </option>
            ))}
          </select>
        </div>
        <Table
          rows={rows}
          empty="Продаж ещё нет. Создайте заказ - цены и доступность проверит сервер."
          columns={[
            {
              key: "number",
              label: "Заказ",
              render: (r) => (
                <button className="link" onClick={() => open(r)}>
                  № {r.number}
                </button>
              ),
            },
            {
              key: "created_at",
              label: "Создан",
              render: (r) => date(r.created_at),
            },
            {
              key: "client_name",
              label: "Покупатель",
              render: (r) => r.client_name || "Розничная продажа",
            },
            {
              key: "status",
              label: "Выполнение",
              render: (r) => (
                <Badge status={r.status}>{labelStatus(r.status)}</Badge>
              ),
            },
            ...(financial
              ? [
                  {
                    key: "total_cents",
                    label: "Сумма",
                    numeric: true,
                    render: (r) => money(r.total_cents),
                  },
                  {
                    key: "paid_cents",
                    label: "Оплачено",
                    numeric: true,
                    render: (r) => money(r.paid_cents - r.refunded_cents),
                  },
                ]
              : []),
            {
              key: "action",
              label: "",
              render: (r) => <Button onClick={() => open(r)}>Открыть</Button>,
            },
          ]}
        />
      </Panel>
      {editor && (
        <OrderEditor
          initial={editor}
          onClose={() => setEditor(null)}
          onSaved={(order) => {
            setEditor(null);
            setSelected(order);
          }}
        />
      )}
      {selected && (
        <OrderDetail
          initial={selected}
          onClose={() => setSelected(null)}
          onEdit={(order) => {
            setSelected(null);
            setEditor(order);
          }}
        />
      )}
    </>
  );
}
function OrderEditor({ initial, onClose, onSaved }) {
  const c = useCRM();
  const baseCacheKey = `bytmarket:draft:v1:${c.auth.id}:${initial.entity_id || c.entity}`;
  const cached = () => {
    if (initial.id) return null;
    try {
      return JSON.parse(localStorage.getItem(baseCacheKey) || "null");
    } catch {
      return null;
    }
  };
  const [draft, setDraft] = useState(() => {
    const saved = cached();
    return initial.id
      ? {
          ...initial,
          lines: (initial.lines || []).map((l) => ({
            product_id: l.product_id,
            quantity: l.qty / (l.unit_factor || 1),
            unit: l.unit || (l.unit_factor > 1 ? "box" : "piece"),
            discount_percent: l.promotion_id ? 0 : l.discount_percent || 0,
          })),
        }
      : saved?.draft || {
          entity_id: c.entity,
          warehouse_id: c.warehouse,
          channel: c.auth.roles.includes("rep") ? "wholesale" : "retail",
          client_id: "",
          fulfillment: "pickup",
          lines: [],
          notes: "",
        };
  });
  const [q, setQ] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(initial.id ? initial : null),
    [cacheNotice, setCacheNotice] = useState(() =>
      cached()
        ? "Восстановлен черновик с устройства. Цены и остатки будут проверены заново."
        : "",
    ),
    [dirty, setDirty] = useState(false);
  const searchRef = useRef();
  const cacheKey = `bytmarket:draft:v1:${c.auth.id}:${draft.entity_id}`;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const valid =
    draft.lines.length > 0 &&
    draft.lines.every(
      (l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0,
    ) &&
    draft.entity_id &&
    draft.warehouse_id &&
    (draft.channel !== "wholesale" || draft.client_id);
  useEffect(() => {
    if (valid) {
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            version: 1,
            updated_at: new Date().toISOString(),
            draft,
          }),
        );
        setCacheNotice(
          "Черновик автоматически сохранён на этом устройстве. Товар не зарезервирован.",
        );
      } catch {
        setCacheNotice(
          "Не удалось сохранить на устройстве. Сохраните черновик на сервер.",
        );
      }
    }
  }, [draft, valid]);
  const change = (patch) => {
    setDraft((v) => ({ ...v, ...patch }));
    setDirty(true);
  };
  const updateLine = (i, patch) =>
    change({
      lines: draft.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)),
    });
  const products = (c.data.products || []).filter(
    (p) =>
      p.active !== false &&
      (p.name + " " + p.sku + " " + p.barcode)
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  function add(p) {
    const idx = draft.lines.findIndex((l) => l.product_id === p.id);
    if (idx >= 0)
      updateLine(idx, { quantity: Number(draft.lines[idx].quantity) + 1 });
    else
      change({
        lines: [
          ...draft.lines,
          { product_id: p.id, quantity: 1, unit: "piece", discount_percent: 0 },
        ],
      });
    setQ("");
    searchRef.current?.focus();
  }
  async function save(close = false) {
    if (!valid)
      throw new Error(
        "Добавьте товары, положительные целые количества и клиента для опта.",
      );
    setBusy(true);
    setError("");
    try {
      const body = {
        ...draft,
        client_id: draft.client_id || null,
        lines: draft.lines.map((l) => ({
          ...l,
          quantity: Number(l.quantity),
          discount_percent: Number(l.discount_percent || 0),
        })),
      };
      if (saved?.id) body.version = saved.version;
      const order = await api("/orders" + (saved?.id ? "/" + saved.id : ""), {
        method: saved?.id ? "PATCH" : "POST",
        body,
      });
      setSaved(order);
      setDirty(JSON.stringify(latestDraft.current) !== JSON.stringify(draft));
      await c.refresh();
      if (close) {
        localStorage.removeItem(cacheKey);
        onSaved(order);
      }
      return order;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  // Auto-save only an already-created, valid draft. An explicit first save establishes its server identity.
  useEffect(() => {
    if (!saved?.id || !dirty || !valid || busy || !c.online) return;
    const t = setTimeout(() => {
      save(false).catch(() => {});
    }, 1800);
    return () => clearTimeout(t);
  }, [draft, dirty, valid, c.online]);
  return (
    <Drawer
      title={initial.id ? "Изменить черновик" : "Новая продажа"}
      onClose={onClose}
      wide
    >
      <div className="drawer-body">
        {initial.changes && (
          <div className="notice">
            <strong>Повтор заказа: проверьте текущие условия</strong>
            {initial.changes.map((x) => (
              <p key={x.product_id}>
                {c.data.products?.find((p) => p.id === x.product_id)?.name}:
                было {money(x.old_price_cents)}, сейчас{" "}
                {money(x.new_price_cents)} за шт.; доступно {x.available} шт.
              </p>
            ))}
          </div>
        )}
        <div className="form-grid">
          <Select
            label="Организация"
            required
            value={draft.entity_id}
            options={c.meta.entities}
            onChange={(e) => change({ entity_id: e.target.value })}
          />
          <Select
            label="Склад"
            required
            value={draft.warehouse_id}
            options={c.meta.warehouses}
            onChange={(e) => change({ warehouse_id: e.target.value })}
          />
          <Select
            label="Тип продажи"
            value={draft.channel}
            options={[
              { value: "retail", label: "Розница" },
              { value: "wholesale", label: "Опт" },
            ]}
            onChange={(e) =>
              change({
                channel: e.target.value,
                entity_id:
                  c.meta.settings[
                    e.target.value === "wholesale"
                      ? "wholesale_entity_id"
                      : "retail_entity_id"
                  ] || draft.entity_id,
              })
            }
          />
          <Select
            label="Покупатель"
            required={draft.channel === "wholesale"}
            value={draft.client_id || ""}
            options={(c.data.clients || []).filter(
              (x) => x.kind !== "supplier",
            )}
            onChange={(e) => change({ client_id: e.target.value })}
          />
        </div>
        <label className="field">
          <span>Сканируйте штрихкод или найдите товар</span>
          <input
            ref={searchRef}
            autoFocus
            value={q}
            placeholder="Название, артикул, штрихкод"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const exact = products.find(
                  (p) => p.barcode === q || p.sku === q,
                );
                if (exact) add(exact);
                else if (products.length === 1) add(products[0]);
              }
            }}
          />
        </label>
        <div className="product-search-results">
          {products.slice(0, 8).map((p) => (
            <div key={p.id} className="product-result">
              <div>
                <strong>{p.name}</strong>
                <small>
                  {p.sku} ·{" "}
                  {draft.channel === "retail"
                    ? money(p.retail_cents)
                    : money(p.wholesale_cents)}{" "}
                  / шт. · доступно{" "}
                  {draft.entity_id === c.entity &&
                  draft.warehouse_id === c.warehouse
                    ? (p.available ?? "неизвестно")
                    : "проверится на сервере"}
                </small>
              </div>
              <Button onClick={() => add(p)}>Добавить</Button>
            </div>
          ))}
          {!products.length && (
            <p className="muted">
              Ничего не найдено. Проверьте запрос или добавьте товар в каталог.
            </p>
          )}
        </div>
        <h3>Состав продажи</h3>
        {draft.lines.length ? (
          <div className="order-lines">
            {draft.lines.map((l, i) => {
              const p = c.data.products?.find((p) => p.id === l.product_id);
              return (
                <div className="edit-line" key={l.product_id + ":" + i}>
                  <div>
                    <strong>{p?.name || "Товар недоступен"}</strong>
                    <small>{p?.sku}</small>
                  </div>
                  <Field
                    label="Количество"
                    type="number"
                    min="1"
                    step="1"
                    value={l.quantity}
                    onChange={(e) =>
                      updateLine(i, { quantity: e.target.value })
                    }
                  />
                  <Select
                    label="Единица"
                    value={l.unit}
                    options={[
                      { value: "piece", label: "Штуки" },
                      {
                        value: "pack",
                        label: `Упаковки (${p?.attributes?.inner_pack_size || 1} шт.)`,
                      },
                      {
                        value: "box",
                        label: `Коробки (${p?.pack_size || 1} шт.)`,
                      },
                    ]}
                    onChange={(e) => updateLine(i, { unit: e.target.value })}
                  />
                  <Field
                    label="Скидка, %"
                    disabled={!c.has("seller", "manager", "rep")}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={l.discount_percent || 0}
                    onChange={(e) =>
                      updateLine(i, { discount_percent: e.target.value })
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label={"Удалить " + p?.name}
                    onClick={() =>
                      change({ lines: draft.lines.filter((_, n) => n !== i) })
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="Корзина пуста">Добавьте товар из поиска.</Empty>
        )}
        <div className="form-grid">
          <Select
            label="Получение"
            value={draft.fulfillment}
            options={[
              { value: "pickup", label: "Самовывоз / выдача сейчас" },
              { value: "delivery", label: "Курьерская доставка" },
            ]}
            onChange={(e) => change({ fulfillment: e.target.value })}
          />
          <Field
            label="Срок оплаты"
            type="date"
            value={draft.due_date || ""}
            onChange={(e) => change({ due_date: e.target.value })}
          />
          {draft.fulfillment === "delivery" &&
            (
              c.data.clients?.find((x) => x.id === draft.client_id)
                ?.addresses || []
            ).length > 0 && (
              <Select
                label="Торговая точка клиента"
                value={(
                  c.data.clients.find((x) => x.id === draft.client_id)
                    ?.addresses || []
                )
                  .findIndex((a) => a.address === draft.address)
                  .toString()}
                options={(
                  c.data.clients.find((x) => x.id === draft.client_id)
                    ?.addresses || []
                ).map((a, i) => ({
                  value: String(i),
                  label: a.name + " · " + a.address,
                }))}
                onChange={(e) => {
                  const a = c.data.clients.find((x) => x.id === draft.client_id)
                    ?.addresses?.[Number(e.target.value)];
                  if (a) change({ address: a.address });
                }}
              />
            )}
          {draft.fulfillment === "delivery" && (
            <Field
              label="Адрес доставки"
              required
              value={draft.address || ""}
              onChange={(e) => change({ address: e.target.value })}
            />
          )}
          <label className="field">
            <span>Комментарий</span>
            <textarea
              value={draft.notes || ""}
              onChange={(e) => change({ notes: e.target.value })}
            />
          </label>
        </div>
        {cacheNotice && <p className="notice">{cacheNotice}</p>}
        {saved && (
          <div className="total-line">
            <span>Расчёт сервера{dirty ? " (будет обновлён)" : ""}</span>
            <strong>{money(saved.total_cents)}</strong>
          </div>
        )}
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
        <p className="muted">
          Сохранение не резервирует товар. Подтверждение заказа повторно
          проверит текущий остаток, условия и права.
        </p>
        <footer className="form-actions">
          <Button onClick={onClose}>Закрыть</Button>
          <Button
            disabled={!valid || !c.online}
            busy={busy}
            onClick={() => save(false).catch(() => {})}
          >
            Рассчитать и сохранить
          </Button>
          <Button
            primary
            disabled={!valid || !c.online}
            busy={busy}
            onClick={() => save(true).catch(() => {})}
          >
            Сохранить и открыть
          </Button>
        </footer>
      </div>
    </Drawer>
  );
}
function OrderDetail({ initial, onClose, onEdit }) {
  const c = useCRM(),
    [order, setOrder] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState(null),
    [print, setPrint] = useState(null);
  const entity = c.meta.entities.find((e) => e.id === order.entity_id);
  async function command(action, body = {}) {
    setBusy(true);
    setError("");
    try {
      const result = await c.mutate("/orders/" + order.id + "/" + action, body);
      if (action === "repeat") {
        const next = result.order || result;
        onEdit(next);
        return;
      }
      setOrder(await api("/orders/" + order.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const sell = c.meta.permissions.can_sell,
    stock = c.meta.permissions.can_stock;
  const financial = c.has("seller", "manager", "rep", "accountant");
  const payable = Math.max(
    0,
    (order.status === "cancelled" ? order.shipped_cents : order.total_cents) -
      (order.returned_cents || 0) -
      (order.paid_cents || 0) +
      (order.refunded_cents || 0),
  );
  return (
    <Drawer title={"Заказ № " + order.number} onClose={onClose} wide>
      <div className="drawer-body">
        <div className="detail-top">
          <div>
            <h3>{order.client_name || "Розничная продажа"}</h3>
            <p>
              {entity?.name} ·{" "}
              {c.meta.warehouses.find((w) => w.id === order.warehouse_id)?.name}
            </p>
            <small>{date(order.created_at)}</small>
          </div>
          <Badge status={order.status}>{labelStatus(order.status)}</Badge>
        </div>
        <Table
          rows={order.lines || []}
          columns={[
            {
              key: "name",
              label: "Товар",
              render: (l) => (
                <>
                  <strong>{l.name}</strong>
                  <small>{l.sku}</small>
                </>
              ),
            },
            { key: "qty", label: "Штук", numeric: true },
            ...(financial
              ? [
                  {
                    key: "unit_price_cents",
                    label: "За штуку",
                    numeric: true,
                    render: (l) => money(l.unit_price_cents),
                  },
                  {
                    key: "line_total_cents",
                    label: "Сумма",
                    numeric: true,
                    render: (l) => money(l.line_total_cents),
                  },
                ]
              : []),
            { key: "shipped_qty", label: "Отгружено", numeric: true },
            { key: "returned_qty", label: "Возврат", numeric: true },
          ]}
        />
        {financial && (
          <div className="money-summary">
            <div>
              Всего<strong>{money(order.total_cents)}</strong>
            </div>
            <div>
              Оплачено
              <strong>
                {money((order.paid_cents || 0) - (order.refunded_cents || 0))}
              </strong>
            </div>
            <div>
              Возвращено товара<strong>{money(order.returned_cents)}</strong>
            </div>
            <div>
              Осталось оплатить<strong>{money(payable)}</strong>
            </div>
          </div>
        )}
        {order.notes && <p>{order.notes}</p>}
        {order.address && <p>Доставка: {order.address}</p>}
        {error && <div className="error-box">{error}</div>}
        <div className="actions wrap">
          {order.status === "draft" && sell && (
            <>
              <Button onClick={() => onEdit(order)}>Изменить</Button>
              <Button primary busy={busy} onClick={() => command("confirm")}>
                Подтвердить и зарезервировать
              </Button>
            </>
          )}
          {order.status !== "draft" &&
            payable > 0 &&
            c.has("seller", "rep", "accountant", "courier") && (
              <Button primary onClick={() => setForm("payment")}>
                Записать оплату
              </Button>
            )}
          {!["draft", "cancelled"].includes(order.status) &&
            (stock || c.has("seller")) &&
            (order.lines || []).some((l) => l.qty > l.shipped_qty) && (
              <Button onClick={() => setForm("ship")}>
                Выдать / отгрузить
              </Button>
            )}
          {order.status !== "draft" &&
            (order.lines || []).some((l) => l.shipped_qty > l.returned_qty) &&
            c.has("warehouse") && (
              <Button onClick={() => setForm("return")}>Возврат товара</Button>
            )}
          {sell && (
            <Button onClick={() => command("repeat")} busy={busy}>
              <Copy size={16} />
              Повторить
            </Button>
          )}
          {!["cancelled", "shipped", "completed"].includes(order.status) &&
            sell && (
              <Button danger onClick={() => setForm("cancel")}>
                Отменить заказ
              </Button>
            )}
          {financial &&
            [
              ["invoice", "Счёт / PDF"],
              ["details", "Реквизиты / PDF"],
              ["shipment", "Отгрузка / PDF"],
            ].map(([kind, title]) => (
              <Button
                key={kind}
                disabled={
                  kind === "shipment" &&
                  order.shipped_cents <= order.returned_cents
                }
                onClick={async () => {
                  try {
                    const doc = await api("/orders/" + order.id + "/document", {
                      method: "POST",
                      body: { kind },
                    });
                    setPrint({ ...doc.content, kind: doc.kind });
                    setTimeout(() => window.print(), 150);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <Printer size={16} />
                {title}
              </Button>
            ))}
        </div>
        <p className="notice">
          Касса не подключена. Запись оплаты не формирует фискальный чек. Для
          смешанной оплаты внесите две подтверждённые записи с соответствующими
          суммами. Безналичное поступление подтверждает бухгалтер или владелец
          по банковскому документу.
        </p>
        {print && (
          <div className="print-sheet">
            <h1>
              {print.kind === "details"
                ? "Реквизиты для оплаты"
                : print.kind === "shipment"
                  ? "Отгрузка по заказу"
                  : "Счёт по заказу"}{" "}
              № {order.number}
            </h1>
            <p>Дата: {date(order.created_at)}</p>
            <h3>{print.entity?.name}</h3>
            <EntityDetails
              details={
                typeof print.entity?.details === "string"
                  ? JSON.parse(print.entity.details)
                  : print.entity?.details
              }
            />
            <p>Покупатель: {print.client?.name || "Розничный покупатель"}</p>
            <Table
              paginate={false}
              rows={print.order.lines || []}
              columns={[
                { key: "name", label: "Наименование" },
                { key: "qty", label: "Штук" },
                {
                  key: "unit_price_cents",
                  label: "Цена",
                  render: (l) => money(l.unit_price_cents),
                },
                {
                  key: "line_total_cents",
                  label: "Сумма",
                  render: (l) => money(l.line_total_cents),
                },
              ]}
            />
            <h2>Итого: {money(print.order.total_cents)}</h2>
            <p>
              Документ не является кассовым чеком. Оплата подтверждается
              отдельно.
            </p>
          </div>
        )}
      </div>
      {form === "payment" && (
        <PaymentForm
          order={order}
          onClose={async () => {
            setForm(null);
            setOrder(await api("/orders/" + order.id));
          }}
        />
      )}
      {["ship", "return"].includes(form) && (
        <LineOperation
          order={order}
          kind={form}
          onClose={() => setForm(null)}
          submit={async (body) => {
            await c.mutate("/orders/" + order.id + "/" + form, body);
            setOrder(await api("/orders/" + order.id));
          }}
        />
      )}
      {form === "cancel" && (
        <RecordForm
          title="Отмена заказа"
          fields={[
            {
              key: "reason",
              label: "Причина",
              type: "textarea",
              required: true,
            },
          ]}
          hint="Резерв будет снят. Подтверждённые оплаты не исчезнут: при необходимости оформите возврат денег отдельно."
          onClose={() => setForm(null)}
          submit={async (body) => {
            await command("cancel", body);
          }}
          submitLabel="Отменить заказ"
        />
      )}
    </Drawer>
  );
}
function EntityDetails({ details }) {
  const d = typeof details === "object" ? details : {};
  return (
    <>
      <p>
        ИНН: {d?.inn || "не заполнен"} · КПП: {d?.kpp || "не указан"}
      </p>
      <p>{d?.address || "Юридический адрес не заполнен"}</p>
      <p>
        Банк: {d?.bank || "не заполнен"} · Р/с: {d?.account || "не заполнен"} ·
        БИК: {d?.bik || "не заполнен"}
      </p>
      {(!d?.inn || !d?.account) && (
        <strong>
          Реквизиты не заполнены полностью. Проверьте перед оплатой.
        </strong>
      )}
    </>
  );
}
function LineOperation({ order, kind, onClose, submit }) {
  const available = (order.lines || [])
    .map((l) => ({
      ...l,
      max:
        kind === "ship"
          ? l.qty - l.shipped_qty
          : l.shipped_qty - l.returned_qty,
    }))
    .filter((l) => l.max > 0);
  const [values, setValues] = useState(
      Object.fromEntries(available.map((l) => [l.id, l.max])),
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Drawer
      title={kind === "ship" ? "Выдача / отгрузка" : "Возврат товара"}
      onClose={onClose}
    >
      <form
        className="drawer-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const lines = available
              .filter((l) => Number(values[l.id]) > 0)
              .map((l) => ({ line_id: l.id, qty: Number(values[l.id]) }));
            if (!lines.length)
              throw new Error("Укажите количество хотя бы в одной строке");
            await submit({ lines, reason });
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {available.map((l) => (
          <Field
            key={l.id}
            label={l.name + " (максимум " + l.max + " шт.)"}
            type="number"
            min="0"
            max={l.max}
            step="1"
            required
            value={values[l.id]}
            onChange={(e) => setValues({ ...values, [l.id]: e.target.value })}
          />
        ))}
        {kind === "return" && (
          <>
            <Field
              label="Причина возврата"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="notice">
              Возврат товара не возвращает деньги автоматически. Состояние
              принятого товара учитывается сервером.
            </p>
          </>
        )}
        {error && <div className="error-box">{error}</div>}
        <Button primary type="submit" busy={busy}>
          Подтвердить фактическое количество
        </Button>
      </form>
    </Drawer>
  );
}
