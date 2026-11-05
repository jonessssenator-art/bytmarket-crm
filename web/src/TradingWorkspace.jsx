import React, { useEffect, useState } from "react";
import { useCRM } from "./App.jsx";
import { api, money, date, parseCsv, csvDownload } from "./api.js";
import {
  Button,
  Panel,
  Table,
  Field,
  Select,
  Drawer,
  RecordForm,
  Empty,
  PageHeading,
} from "./ui.jsx";
import { Segmented } from "./print360/ui/index.jsx";
import { makeXlsx } from "./export-xlsx.mjs";
const field = (key, label, type = "text", required = true, extra = {}) => ({
  key,
  label,
  type,
  required,
  ...extra,
});
const amount = field("amount", "Сумма, ₽", "number", true, {
  min: 0.01,
  step: 0.01,
});
const cents = (v) => {
  const n = Math.round(Number(v) * 100);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw Error("Укажите положительную сумму");
  return n;
};
const emptyMoney = (v) => (v == null ? "Нет оценки" : money(v));
const localDay = () =>
  new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const opts = (rows) => rows.map((r) => ({ value: r.id, label: r.name }));
function useRows(path) {
  const c = useCRM(),
    [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api(path)
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, version, c.data]);
  return { rows, error, loading, reload: () => setVersion((x) => x + 1) };
}
function Status({ data }) {
  return data.error ? (
    <div role="alert" className="error-box">
      {data.error}
    </div>
  ) : data.loading ? (
    <p className="notice">Загрузка данных…</p>
  ) : null;
}
function exportRows(name, headers, rows) {
  const url = URL.createObjectURL(
    new Blob([makeXlsx(headers, rows)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TradingWorkspace({ page, children }) {
  const c = useCRM();
  const [tab, setTab] = useState(() => c.navigationTarget?.tab || "main");
  useEffect(
    () => setTab(c.navigationTarget?.tab || "main"),
    [page, c.navigationTarget?.key],
  );
  const extra =
    {
      products: [["photos", "Фотографии"]],
      stock: [
        ["stocktakes", "Инвентаризации"],
        ["batches", "Партии и возвраты"],
      ],
      purchases: c.has("accountant")
        ? [
            ["suggestions", "Что закупить"],
            ["suppliers", "Расчёты с поставщиками"],
          ]
        : [],
      finance: [
        ...(c.has("accountant") ? [["suppliers", "Поставщики"]] : []),
        ["opening", "Начальные долги"],
      ],
      clients: [
        ["clientwork", "Контакты и точки"],
        ["prices", "Индивидуальные цены"],
        ["tasks", "Задачи"],
      ],
      orders: [
        ["approvals", "Согласования"],
        ...(c.has("warehouse") ? [["packing", "Сборка"]] : []),
      ],
      reports: [
        ["details", "Товары"],
        ["employees", "Сотрудники"],
        ["growth", "Точки роста"],
        ["operations", "Клиенты, запас и доставка"],
        ["plans", "План / факт"],
        ["digest", "Сводки владельцу"],
        ["attention", "Требует внимания"],
      ],
      settings: [
        ["policy", "Ценовая политика"],
        ["rights", "Права сотрудников"],
        ["audit", "Журнал действий"],
        ["imports", "Перенос данных"],
      ],
      deliveries: [["deliverydetails", "Сроки и стоимость"]],
      visits: [
        ["tasks", "Задачи"],
        ["plans", "Мой план"],
      ],
      home: [["tasks", "Мои задачи"]],
    }[page] || [];
  const safe = (
    page === "stock" && !c.has("warehouse", "accountant") ? [] : extra
  ).filter(([key]) => key !== "digest" || c.has());
  if (!safe.length) return children;
  const screens = {
    stocktakes: <Stocktakes />,
    batches: <Batches />,
    suggestions: <Suggestions />,
    suppliers: <SupplierLedger />,
    opening: <OpeningDebts />,
    photos: <ProductPhotos />,
    prices: <Prices />,
    tasks: <Tasks />,
    clientwork: <ClientWork />,
    approvals: <Approvals />,
    packing: <Packing />,
    details: <DetailedReports key="products" />,
    employees: <DetailedReports key="employees" initialGroup="employees" />,
    growth: <Growth />,
    attention: <Attention />,
    operations: <OperationalReports />,
    plans: <Plans />,
    deliverydetails: <DeliveryDetails />,
    policy: <Policy />,
    audit: <Audit />,
    imports: <ImportData />,
    rights: <Rights />,
    digest: <Digest />,
  };
  if (page === "home" && tab === "main") return children;
  return (
    <>
      <div className="bm-work-tabs bm-work-tabs--simple">
        <Segmented
          options={[
            {
              value: "main",
              label:
                page === "home"
                  ? "Главное"
                  : page === "reports"
                    ? "Прибыль и продажи"
                    : {
                        orders: "Заказы",
                        stock: "Остатки",
                        clients: "Клиенты",
                        products: "Товары",
                        finance: "Деньги",
                        purchases: "Закупки",
                        deliveries: "Доставки",
                        visits: "Визиты",
                        settings: "Основные настройки",
                      }[page] || "Основное",
            },
            ...(page === "reports"
              ? safe
                  .filter(([key]) =>
                    ["details", "employees", "growth"].includes(key),
                  )
                  .map(([value, label]) => ({ value, label }))
              : []),
          ]}
          value={tab}
          onChange={setTab}
        />
        <select
          aria-label={page === "reports" ? "Другие отчёты" : "Другие действия"}
          value={safe.some(([key]) => key === tab) ? tab : ""}
          onChange={(event) => setTab(event.target.value || "main")}
        >
          <option value="">
            {page === "reports" ? "Другие отчёты" : "Другие действия"}
          </option>
          {safe.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {tab === "main" ? (
        children
      ) : (
        <>
          <PageHeading>
            <div />
          </PageHeading>
          {screens[tab]}
        </>
      )}
    </>
  );
}
export function PurchaseReceive({ purchase, onClose }) {
  const c = useCRM(),
    [values, setValues] = useState(
      Object.fromEntries(
        purchase.lines.map((l) => [
          l.id,
          {
            qty: l.qty - (l.received_qty || 0),
            quarantine: false,
            reason: "",
            expires_at: l.expires_at || "",
            batch_number: l.batch_number || "",
          },
        ]),
      ),
    ),
    [due, setDue] = useState(""),
    [closeReason, setCloseReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Drawer title="Фактическая приёмка" onClose={onClose} wide>
      <form
        className="drawer-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await c.mutate("/purchases/" + purchase.id + "/receive", {
              lines: Object.entries(values)
                .filter(([, v]) => Number(v.qty) > 0)
                .map(([line_id, v]) => ({
                  ...v,
                  line_id,
                  qty: Number(v.qty),
                  expires_at: v.expires_at || null,
                })),
              due_date: due || null,
            });
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Укажите только фактически принятые штуки. Неполученный остаток
          останется ожидаемым; брак попадёт в карантин.
        </p>
        {purchase.lines
          .filter((l) => l.qty > (l.received_qty || 0))
          .map((l) => {
            const v = values[l.id],
              change = (patch) =>
                setValues({ ...values, [l.id]: { ...v, ...patch } });
            return (
              <fieldset className="bm-form-group" key={l.id}>
                <legend>
                  {c.data.products?.find((p) => p.id === l.product_id)?.name ||
                    l.product_id}
                </legend>
                <div className="form-grid">
                  <Field
                    label={
                      "Принято, шт. (осталось " +
                      (l.qty - (l.received_qty || 0)) +
                      ")"
                    }
                    type="number"
                    min="0"
                    max={l.qty - (l.received_qty || 0)}
                    value={v.qty}
                    onChange={(e) => change({ qty: e.target.value })}
                  />
                  <Field
                    label="Партия"
                    value={v.batch_number}
                    onChange={(e) => change({ batch_number: e.target.value })}
                  />
                  <Field
                    label="Годен до"
                    type="date"
                    value={v.expires_at}
                    onChange={(e) => change({ expires_at: e.target.value })}
                  />
                  <Field
                    label="Причина расхождения"
                    required={v.quarantine}
                    value={v.reason}
                    onChange={(e) => change({ reason: e.target.value })}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={v.quarantine}
                      onChange={(e) => change({ quarantine: e.target.checked })}
                    />{" "}
                    Принять в карантин
                  </label>
                </div>
              </fieldset>
            );
          })}
        <Table
          rows={purchase.lines}
          columns={[
            {
              key: "product_id",
              label: "Товар",
              render: (r) =>
                c.data.products?.find((p) => p.id === r.product_id)?.name ||
                r.product_id,
            },
            { key: "qty", label: "Заказано" },
            { key: "received_qty", label: "Принято" },
          ]}
        />
        <Field
          label="Срок оплаты поставщику"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <footer className="form-actions">
          <Button onClick={onClose} type="button">
            Отмена
          </Button>
          <Button
            primary
            busy={busy}
            type="submit"
            disabled={
              !["ordered", "partially_received"].includes(purchase.status)
            }
          >
            Провести приёмку
          </Button>
        </footer>
        {c.has("accountant") &&
          ["ordered", "partially_received"].includes(purchase.status) && (
            <div className="bm-form-group">
              <Field
                label="Причина закрытия неполученного остатка"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              />
              <Button
                type="button"
                disabled={!closeReason.trim()}
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await c.mutate("/purchases/" + purchase.id + "/close", {
                      reason: closeReason,
                    });
                    onClose();
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Закрыть остаток без приёмки
              </Button>
            </div>
          )}
      </form>
    </Drawer>
  );
}
function SupplierLedger() {
  const c = useCRM(),
    data = useRows("/supplier-ledger?entity_id=" + c.entity),
    [form, setForm] = useState(false);
  const balance = data.rows.reduce((s, r) => s + r.amount_cents, 0);
  return (
    <>
      <Status data={data} />
      <Panel
        title="Взаиморасчёты с поставщиками"
        action={
          <Button primary onClick={() => setForm(true)}>
            Записать операцию
          </Button>
        }
      >
        <p className="notice">
          Общий баланс: {money(balance)}. Положительный - должны поставщикам,
          отрицательный - авансы и переплаты. Приёмки и возвраты отражаются
          автоматически.
        </p>
        <Table
          rows={data.rows}
          columns={[
            {
              key: "created_at",
              label: "Дата",
              render: (r) => date(r.created_at),
            },
            { key: "supplier_name", label: "Поставщик" },
            {
              key: "kind",
              label: "Операция",
              render: (r) =>
                ({
                  receipt: "Приёмка",
                  return: "Возврат товара",
                  opening: "Начальный долг",
                  payment: "Оплата поставщику",
                  refund: "Возврат аванса",
                })[r.kind],
            },
            {
              key: "amount_cents",
              label: "Изменение долга",
              render: (r) => money(r.amount_cents),
            },
            { key: "due_date", label: "Срок оплаты" },
            { key: "reason", label: "Основание" },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title="Расчёты с поставщиком"
          onClose={() => setForm(false)}
          fields={[
            field("supplier_id", "Поставщик", "select", true, {
              options: opts(
                (c.data.clients || []).filter((x) => x.kind === "supplier"),
              ),
            }),
            field("kind", "Операция", "select", true, {
              options: [
                { value: "opening", label: "Начальный долг поставщику" },
                { value: "payment", label: "Фактическая оплата поставщику" },
                { value: "refund", label: "Поставщик вернул аванс" },
              ],
            }),
            amount,
            field("due_date", "Срок оплаты", "date", false),
            field("reason", "Основание / платёжный документ", "textarea"),
          ]}
          submit={async (b) => {
            await c.mutate("/supplier-ledger", {
              ...b,
              entity_id: c.entity,
              amount_cents: cents(b.amount),
            });
            setForm(false);
          }}
        />
      )}
    </>
  );
}
function OpeningDebts() {
  const c = useCRM(),
    data = useRows("/opening-debts?entity_id=" + c.entity),
    [form, setForm] = useState(null);
  return (
    <>
      <Status data={data} />
      <Panel
        title="Начальные долги покупателей"
        action={
          c.has("accountant") && (
            <Button primary onClick={() => setForm({ new: true })}>
              Внести долг из блокнота
            </Button>
          )
        }
      >
        <p className="notice">
          Не создаёт фиктивную продажу. Остаток:{" "}
          {money(data.rows.reduce((s, r) => s + r.remaining_cents, 0))}.
        </p>
        <Table
          rows={data.rows}
          columns={[
            { key: "client_name", label: "Покупатель" },
            {
              key: "amount_cents",
              label: "Начальный долг",
              render: (r) => money(r.amount_cents),
            },
            {
              key: "remaining_cents",
              label: "Осталось",
              render: (r) => money(r.remaining_cents),
            },
            { key: "due_date", label: "Срок" },
            { key: "reason", label: "Основание" },
            {
              key: "action",
              label: "",
              render: (r) =>
                r.remaining_cents > 0 &&
                c.has("accountant", "rep", "seller") && (
                  <Button onClick={() => setForm(r)}>Принять оплату</Button>
                ),
            },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title={form.new ? "Начальный долг" : "Погашение начального долга"}
          onClose={() => setForm(null)}
          fields={
            form.new
              ? [
                  field("client_id", "Покупатель", "select", true, {
                    options: opts(
                      (c.data.clients || []).filter(
                        (x) => x.kind !== "supplier",
                      ),
                    ),
                  }),
                  amount,
                  field("due_date", "Срок оплаты", "date", false),
                  field("reason", "Основание / запись блокнота", "textarea"),
                ]
              : [
                  amount,
                  field("method", "Способ оплаты", "select", true, {
                    options: [
                      { value: "cash", label: "Наличные" },
                      { value: "bank", label: "Безналичный перевод" },
                    ],
                  }),
                  field("reference", "Основание платежа", "text", false),
                ]
          }
          submit={async (b) => {
            await c.mutate(
              form.new
                ? "/opening-debts"
                : "/opening-debts/" + form.id + "/pay",
              { ...b, entity_id: c.entity, amount_cents: cents(b.amount) },
            );
            setForm(null);
          }}
        />
      )}
    </>
  );
}
function Stocktakes() {
  const c = useCRM(),
    data = useRows(
      "/stocktakes?" +
        new URLSearchParams({ entity_id: c.entity, warehouse_id: c.warehouse }),
    ),
    [form, setForm] = useState(null),
    [counts, setCounts] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Status data={data} />
      <Panel
        title="Инвентаризации"
        action={
          <Button primary onClick={() => setForm({ new: true })}>
            Начать пересчёт
          </Button>
        }
      >
        <Table
          rows={data.rows}
          columns={[
            {
              key: "created_at",
              label: "Создан",
              render: (r) => date(r.created_at),
            },
            { key: "reason", label: "Основание" },
            {
              key: "status",
              label: "Состояние",
              render: (r) =>
                ({
                  draft: "Пересчёт",
                  posted: "Проведён",
                  cancelled: "Отменён",
                })[r.status],
            },
            {
              key: "action",
              label: "",
              render: (r) => (
                <Button
                  onClick={() => {
                    setForm(r);
                    setCounts(
                      r.status === "posted"
                        ? r.counts
                        : Object.fromEntries(
                            r.snapshot.map((b) => [
                              b.id,
                              { qty: b.qty, quarantine: b.quarantine },
                            ]),
                          ),
                    );
                    setError("");
                  }}
                >
                  Открыть ведомость
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {form?.new ? (
        <RecordForm
          title="Начать инвентаризацию"
          fields={[field("reason", "Основание / номер ведомости", "textarea")]}
          onClose={() => setForm(null)}
          submit={async (b) => {
            await c.mutate("/stocktakes", {
              ...b,
              entity_id: c.entity,
              warehouse_id: c.warehouse,
            });
            setForm(null);
          }}
        />
      ) : (
        form && (
          <Drawer
            title="Сличительная ведомость"
            onClose={() => setForm(null)}
            wide
          >
            <div className="drawer-body">
              <p className="notice">
                Если после создания снимка менялись остатки или резервы,
                проведение будет отклонено. Излишек новой партии оформляется
                отдельным приходом.
              </p>
              <Table
                rows={form.snapshot}
                columns={[
                  {
                    key: "product_id",
                    label: "Товар",
                    render: (r) =>
                      c.data.products?.find((p) => p.id === r.product_id)
                        ?.name || r.product_id,
                  },
                  {
                    key: "id",
                    label: "Партия",
                    render: (r) => r.id.slice(0, 8),
                  },
                  { key: "qty", label: "По учёту" },
                  { key: "reserved", label: "Резерв" },
                  {
                    key: "actual",
                    label: "Годных фактически",
                    render: (r) => (
                      <input
                        aria-label={"Годных " + r.id}
                        type="number"
                        min={r.reserved}
                        disabled={form.status !== "draft"}
                        value={counts[r.id]?.qty ?? ""}
                        onChange={(e) =>
                          setCounts({
                            ...counts,
                            [r.id]: {
                              ...counts[r.id],
                              qty: Number(e.target.value),
                            },
                          })
                        }
                      />
                    ),
                  },
                  {
                    key: "quarantine",
                    label: "Карантин фактически",
                    render: (r) => (
                      <input
                        aria-label={"Карантин " + r.id}
                        type="number"
                        min="0"
                        disabled={form.status !== "draft"}
                        value={counts[r.id]?.quarantine ?? ""}
                        onChange={(e) =>
                          setCounts({
                            ...counts,
                            [r.id]: {
                              ...counts[r.id],
                              quarantine: Number(e.target.value),
                            },
                          })
                        }
                      />
                    ),
                  },
                ]}
              />
              {error && <p className="error-box">{error}</p>}
              {form.status === "draft" && (
                <footer className="form-actions">
                  <Button
                    busy={busy}
                    onClick={async () => {
                      try {
                        setBusy(true);
                        await c.mutate("/stocktakes/" + form.id + "/cancel");
                        setForm(null);
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Отменить снимок
                  </Button>
                  {c.has("accountant") && (
                    <Button
                      primary
                      busy={busy}
                      onClick={async () => {
                        try {
                          setBusy(true);
                          await c.mutate("/stocktakes/" + form.id + "/post", {
                            counts,
                          });
                          setForm(null);
                        } catch (e) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Провести результаты
                    </Button>
                  )}
                </footer>
              )}
            </div>
          </Drawer>
        )
      )}
    </>
  );
}
function Batches() {
  const c = useCRM(),
    data = useRows(
      "/stock/batches?" +
        new URLSearchParams({ entity_id: c.entity, warehouse_id: c.warehouse }),
    ),
    [form, setForm] = useState(null);
  return (
    <>
      <Status data={data} />
      <Panel title="Партии и возвраты поставщику">
        <Table
          rows={data.rows}
          columns={[
            { key: "name", label: "Товар" },
            { key: "batch_number", label: "Партия" },
            { key: "expires_at", label: "Годен до" },
            { key: "qty", label: "Годных" },
            { key: "reserved", label: "Резерв" },
            { key: "quarantine", label: "Карантин" },
            {
              key: "action",
              label: "",
              render: (r) =>
                c.has("accountant") &&
                r.supplier_id && (
                  <Button onClick={() => setForm(r)}>Вернуть поставщику</Button>
                ),
            },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title={"Возврат: " + form.name}
          onClose={() => setForm(null)}
          fields={[
            field("qty", "Количество, шт.", "number", true, {
              min: 1,
              step: 1,
            }),
            field("quarantine", "Из карантина", "checkbox", false),
            field("reason", "Причина и документ возврата", "textarea"),
          ]}
          submit={async (b) => {
            await c.mutate("/supplier-returns", {
              ...b,
              qty: Number(b.qty),
              batch_id: form.id,
            });
            setForm(null);
          }}
        />
      )}
    </>
  );
}
function Suggestions() {
  const c = useCRM(),
    [lead, setLead] = useState(7),
    data = useRows(
      "/purchase-suggestions?" +
        new URLSearchParams({
          entity_id: c.entity,
          warehouse_id: c.warehouse,
          lead: lead || 7,
        }),
    );
  return (
    <>
      <Field
        label="Срок поставки, дней"
        type="number"
        min="1"
        max="365"
        value={lead}
        onChange={(e) => setLead(e.target.value)}
      />
      <Status data={data} />
      <Panel
        title="Предложения на закупку"
        action={
          <Button
            disabled={!c.meta.permissions.export_data}
            onClick={() =>
              exportRows(
                "Предложения на закупку",
                ["Артикул", "Товар", "Доступно", "Ожидается", "Заказать, шт."],
                data.rows.map((r) => [
                  r.sku,
                  r.name,
                  r.available,
                  r.expected,
                  r.qty,
                ]),
              )
            }
          >
            Excel
          </Button>
        }
      >
        <p className="notice">
          Целевой запас = максимум из минимального остатка и продаж за 30 дней ×
          срок поставки / 30. Вычитаем доступный остаток и ожидаемые поставки,
          округляем до упаковки. Это предложение для проверки сотрудником.
        </p>
        <Table
          rows={data.rows}
          columns={[
            { key: "name", label: "Товар" },
            { key: "available", label: "Доступно" },
            { key: "reserved", label: "Резерв" },
            { key: "expected", label: "Ожидается" },
            { key: "sold", label: "Продано за 30 дней" },
            { key: "qty", label: "Предложено, шт." },
            { key: "note", label: "Оговорка" },
          ]}
        />
      </Panel>
    </>
  );
}
function Prices() {
  const c = useCRM(),
    data = useRows("/client-prices?entity_id=" + c.entity),
    [form, setForm] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Status data={data} />
      {error && <p className="error-box">{error}</p>}
      <Panel
        title="Индивидуальные цены"
        action={
          c.has() && (
            <Button primary onClick={() => setForm(true)}>
              Установить цену
            </Button>
          )
        }
      >
        <p className="notice">
          Индивидуальная цена заменяет розничную или оптовую базу для клиента в
          выбранной организации. Акция и ручная скидка не суммируются:
          применяется большая. История документов сохраняется.
        </p>
        <Table
          rows={data.rows}
          columns={[
            { key: "client_name", label: "Клиент" },
            { key: "product_name", label: "Товар" },
            {
              key: "price_cents",
              label: "За штуку",
              render: (r) => money(r.price_cents),
            },
            {
              key: "action",
              label: "",
              render: (r) =>
                c.has() && (
                  <Button
                    onClick={async () => {
                      try {
                        await c.mutate("/client-prices/remove", r);
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Убрать
                  </Button>
                ),
            },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title="Индивидуальная цена"
          onClose={() => setForm(false)}
          fields={[
            field("client_id", "Клиент", "select", true, {
              options: opts(c.data.clients || []),
            }),
            field("product_id", "Товар", "select", true, {
              options: opts(c.data.products || []),
            }),
            field("price", "Цена за штуку, ₽", "number", true, {
              min: 0,
              step: 0.01,
            }),
          ]}
          submit={async (b) => {
            await c.mutate("/client-prices", {
              ...b,
              entity_id: c.entity,
              price_cents: Math.round(Number(b.price) * 100),
            });
            setForm(false);
          }}
        />
      )}
    </>
  );
}
function Tasks() {
  const c = useCRM(),
    data = useRows("/tasks?entity_id=" + c.entity),
    [form, setForm] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Status data={data} />
      {error && <p className="error-box">{error}</p>}
      <Panel
        title="Задачи и напоминания"
        action={
          <Button primary onClick={() => setForm(true)}>
            Создать задачу
          </Button>
        }
      >
        <div className="bm-desktop-table">
          <Table
            rows={data.rows}
            columns={[
              { key: "due_date", label: "Срок" },
              { key: "title", label: "Задача" },
              { key: "client_name", label: "Клиент" },
              { key: "employee_name", label: "Ответственный" },
              {
                key: "status",
                label: "Состояние",
                render: (r) =>
                  ({
                    open: r.due_date < localDay() ? "Просрочена" : "Открыта",
                    done: "Выполнена",
                    cancelled: "Отменена",
                  })[r.status],
              },
              { key: "note", label: "Заметка" },
              {
                key: "action",
                label: "",
                render: (r) =>
                  r.status === "open" && (
                    <Button
                      onClick={async () => {
                        try {
                          await c.mutate(
                            "/tasks/" + r.id,
                            { status: "done" },
                            "PATCH",
                          );
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      Выполнено
                    </Button>
                  ),
              },
            ]}
          />
        </div>
        <div className="bm-mobile-list">
          {data.rows.map((r) => (
            <article key={r.id}>
              <strong>{r.title}</strong>
              <p>
                {r.due_date.split("-").reverse().join(".")} ·{" "}
                {r.client_name || r.employee_name}
              </p>
              <span>
                {r.status === "open"
                  ? r.due_date < localDay()
                    ? "Просрочена"
                    : "Открыта"
                  : r.status === "done"
                    ? "Выполнена"
                    : "Отменена"}
              </span>
              {r.note && <p>{r.note}</p>}
              {r.status === "open" && (
                <Button
                  onClick={async () => {
                    try {
                      await c.mutate(
                        "/tasks/" + r.id,
                        { status: "done" },
                        "PATCH",
                      );
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Выполнено
                </Button>
              )}
            </article>
          ))}
          {!data.rows.length && <Empty title="Задач пока нет" />}
        </div>
      </Panel>
      {form && (
        <RecordForm
          title="Новая задача"
          onClose={() => setForm(false)}
          fields={[
            field("title", "Что сделать"),
            field("due_date", "Срок", "date"),
            field("client_id", "Клиент", "select", false, {
              options: opts(c.data.clients || []),
            }),
            ...(c.has()
              ? [
                  field("assigned_to", "Ответственный", "select", true, {
                    options: opts(c.meta.users || []),
                  }),
                ]
              : []),
            field("note", "Примечание", "textarea", false),
          ]}
          submit={async (b) => {
            await c.mutate("/tasks", { ...b, entity_id: c.entity });
            setForm(false);
          }}
        />
      )}
    </>
  );
}
function ClientWork() {
  const c = useCRM(),
    [selected, setSelected] = useState(null),
    [contacts, setContacts] = useState([]),
    [addresses, setAddresses] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Panel title="Контактные лица и торговые точки">
        <Table
          rows={c.data.clients || []}
          columns={[
            { key: "name", label: "Клиент" },
            {
              key: "contacts",
              label: "Контакты",
              render: (r) => (r.contacts || []).length,
            },
            {
              key: "addresses",
              label: "Точки",
              render: (r) => (r.addresses || []).length,
            },
            {
              key: "action",
              label: "",
              render: (r) => (
                <Button
                  onClick={() => {
                    setSelected(r);
                    setContacts(r.contacts || []);
                    setAddresses(r.addresses || []);
                    setError("");
                  }}
                >
                  Открыть
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {selected && (
        <Drawer title={selected.name} onClose={() => setSelected(null)}>
          <form
            className="drawer-body"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await c.mutate(
                  "/clients/" + selected.id,
                  { contacts, addresses },
                  "PATCH",
                );
                setSelected(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Контакты</h3>
            {contacts.map((r, i) => (
              <div className="bm-form-group" key={i}>
                <Field
                  required
                  label="Имя"
                  value={r.name || ""}
                  onChange={(e) =>
                    setContacts(
                      contacts.map((v, k) =>
                        k === i ? { ...v, name: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Field
                  label="Телефон"
                  value={r.phone || ""}
                  onChange={(e) =>
                    setContacts(
                      contacts.map((v, k) =>
                        k === i ? { ...v, phone: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  onClick={() =>
                    setContacts(contacts.filter((_, k) => k !== i))
                  }
                >
                  Удалить контакт
                </Button>
              </div>
            ))}
            <Button
              type="button"
              onClick={() =>
                setContacts([...contacts, { name: "", phone: "" }])
              }
            >
              Добавить контакт
            </Button>
            <h3>Торговые точки</h3>
            {addresses.map((r, i) => (
              <div className="bm-form-group" key={i}>
                <Field
                  required
                  label="Название точки"
                  value={r.name || ""}
                  onChange={(e) =>
                    setAddresses(
                      addresses.map((v, k) =>
                        k === i ? { ...v, name: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Field
                  required
                  label="Адрес"
                  value={r.address || ""}
                  onChange={(e) =>
                    setAddresses(
                      addresses.map((v, k) =>
                        k === i ? { ...v, address: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  onClick={() =>
                    setAddresses(addresses.filter((_, k) => k !== i))
                  }
                >
                  Удалить точку
                </Button>
              </div>
            ))}
            <Button
              type="button"
              onClick={() =>
                setAddresses([...addresses, { name: "", address: "" }])
              }
            >
              Добавить точку
            </Button>
            {error && <p className="error-box">{error}</p>}
            <footer className="form-actions">
              <Button type="submit" primary busy={busy}>
                Сохранить
              </Button>
            </footer>
          </form>
        </Drawer>
      )}
    </>
  );
}
function Approvals() {
  const c = useCRM(),
    data = useRows("/approvals"),
    [form, setForm] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Status data={data} />
      {error && <p className="error-box">{error}</p>}
      <Panel
        title="Согласование исключений"
        action={
          c.has("seller", "manager", "rep") && (
            <Button primary onClick={() => setForm(true)}>
              Запросить решение
            </Button>
          )
        }
      >
        <p className="notice">
          Решение действует только для указанной версии заказа. После изменения
          суммы, состава или оплаты нужно повторное согласование.
        </p>
        <Table
          rows={data.rows}
          columns={[
            { key: "number", label: "Заказ" },
            { key: "version", label: "Версия" },
            {
              key: "kind",
              label: "Вопрос",
              render: (r) =>
                r.kind === "price" ? "Цена / маржа" : "Отгрузка в долг",
            },
            { key: "reason", label: "Обоснование" },
            {
              key: "status",
              label: "Решение",
              render: (r) =>
                ({
                  pending: "Ожидает",
                  approved: "Разрешено",
                  rejected: "Отклонено",
                })[r.status],
            },
            {
              key: "action",
              label: "",
              render: (r) =>
                c.has() &&
                r.status === "pending" && (
                  <div className="actions">
                    <Button
                      onClick={async () => {
                        try {
                          await c.mutate("/approvals/" + r.id + "/decide", {
                            status: "approved",
                          });
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      Разрешить
                    </Button>
                    <Button
                      onClick={async () => {
                        try {
                          await c.mutate("/approvals/" + r.id + "/decide", {
                            status: "rejected",
                          });
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      Отклонить
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title="Запросить согласование"
          onClose={() => setForm(false)}
          fields={[
            field("order_id", "Заказ", "select", true, {
              options: (c.data.orders || [])
                .filter((o) =>
                  ["draft", "confirmed", "partially_shipped"].includes(
                    o.status,
                  ),
                )
                .map((o) => ({ value: o.id, label: o.number })),
            }),
            field("kind", "Исключение", "select", true, {
              options: [
                { value: "price", label: "Скидка / минимальная маржа" },
                { value: "credit", label: "Отгрузка сверх кредитных условий" },
              ],
            }),
            field("reason", "Почему требуется исключение", "textarea"),
          ]}
          submit={async (b) => {
            await c.mutate("/orders/" + b.order_id + "/approval", b);
            setForm(false);
          }}
        />
      )}
    </>
  );
}
function Packing() {
  const c = useCRM(),
    [form, setForm] = useState(null),
    [lines, setLines] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Panel title="Сборка заказов">
        <Table
          rows={(c.data.orders || []).filter((o) =>
            ["confirmed", "partially_shipped"].includes(o.status),
          )}
          columns={[
            { key: "number", label: "Заказ" },
            {
              key: "created_at",
              label: "Создан",
              render: (r) => date(r.created_at),
            },
            {
              key: "action",
              label: "",
              render: (r) => (
                <Button
                  onClick={async () => {
                    try {
                      const o = await api("/orders/" + r.id),
                        p = await api("/orders/" + r.id + "/packing");
                      setForm(o);
                      setLines(p.lines);
                      setError("");
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Лист сборки
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {error && <p className="error-box">{error}</p>}
      {form && (
        <Drawer title={"Сборка " + form.number} onClose={() => setForm(null)}>
          <div className="drawer-body">
            {form.lines.map((l) => (
              <Field
                key={l.id}
                type="number"
                min="0"
                max={l.qty - l.shipped_qty}
                label={
                  l.name + " - собрать " + (l.qty - l.shipped_qty) + " шт."
                }
                value={lines[l.id] ?? 0}
                onChange={(e) =>
                  setLines({ ...lines, [l.id]: Number(e.target.value) })
                }
              />
            ))}
            {error && <p className="error-box">{error}</p>}
            <footer className="form-actions">
              {[
                ["picking", "Сохранить сборку"],
                ["ready", "Всё собрано"],
              ].map(([status, label]) => (
                <Button
                  key={status}
                  primary={status === "ready"}
                  busy={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await c.mutate("/orders/" + form.id + "/packing", {
                        status,
                        lines,
                      });
                      setForm(null);
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {label}
                </Button>
              ))}
            </footer>
          </div>
        </Drawer>
      )}
    </>
  );
}
function DetailedReports({ initialGroup = "products" }) {
  const c = useCRM(),
    [from, setFrom] = useState(localDay().slice(0, 7) + "-01"),
    [to, setTo] = useState(localDay()),
    [group, setGroup] = useState(initialGroup),
    [detail, setDetail] = useState(null),
    data = useRows(
      "/reports/detail?" +
        new URLSearchParams({ entity_id: c.entity, from, to }),
    );
  const rows = (data.rows?.[group] || []).map((r) =>
    group === "promotions"
      ? {
          ...r,
          name: c.data.promotions?.find((p) => p.id === r.id)?.name || r.name,
        }
      : r,
  );
  return (
    <>
      <div className="toolbar">
        <Field
          type="date"
          label="С"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          type="date"
          label="По"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Select
          label="Разрез"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          options={[
            ["products", "Товары"],
            ["categories", "Категории"],
            ["brands", "Бренды"],
            ["clients", "Клиенты"],
            ["employees", "Сотрудники"],
            ["promotions", "Акции"],
          ].map(([value, label]) => ({ value, label }))}
        />
      </div>
      <Status data={data} />
      <Panel
        title="Продажи и валовая прибыль"
        action={
          <Button
            disabled={!c.meta.permissions.export_data}
            onClick={() =>
              exportRows(
                "Отчёт",
                [
                  "Название",
                  "Количество",
                  "Продажи, ₽",
                  "Себестоимость, ₽",
                  "Валовая прибыль, ₽",
                ],
                rows.map((r) => [
                  r.name,
                  r.qty,
                  r.sales_cents == null ? null : r.sales_cents / 100,
                  r.cost_cents == null ? null : r.cost_cents / 100,
                  r.gross_profit_cents == null
                    ? null
                    : r.gross_profit_cents / 100,
                ]),
              )
            }
          >
            Excel
          </Button>
        }
      >
        <p className="notice">
          {data.rows.note?.replace("суммы в копейках", "суммы в рублях")}
        </p>
        <Table
          rows={rows}
          columns={[
            { key: "name", label: "Название" },
            { key: "qty", label: "Штук" },
            { key: "orders", label: "Заказов" },
            {
              key: "sales_cents",
              label: "Продажи",
              render: (r) => emptyMoney(r.sales_cents),
            },
            {
              key: "cost_cents",
              label: "Себестоимость",
              render: (r) => emptyMoney(r.cost_cents),
            },
            {
              key: "gross_profit_cents",
              label: "Валовая прибыль",
              render: (r) => emptyMoney(r.gross_profit_cents),
            },
            {
              key: "action",
              label: "",
              render: (r) => (
                <Button onClick={() => setDetail(r)}>Документы</Button>
              ),
            },
          ]}
        />
      </Panel>
      {detail && (
        <Drawer
          title={"Документы: " + detail.name}
          wide
          onClose={() => setDetail(null)}
        >
          <div className="drawer-body">
            <Table
              rows={detail.documents}
              columns={[
                {
                  key: "created_at",
                  label: "Дата",
                  render: (r) => date(r.created_at),
                },
                { key: "number", label: "Заказ" },
                {
                  key: "kind",
                  label: "Операция",
                  render: (r) => (r.kind === "ship" ? "Отгрузка" : "Возврат"),
                },
                { key: "product_name", label: "Товар" },
                { key: "qty", label: "Движение, шт." },
                {
                  key: "revenue_cents",
                  label: "Продажи",
                  render: (r) => emptyMoney(r.revenue_cents),
                },
                {
                  key: "action",
                  label: "",
                  render: (r) => (
                    <Button
                      onClick={() => c.openPage("orders", { id: r.order_id })}
                    >
                      Открыть заказ
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        </Drawer>
      )}
    </>
  );
}
function Attention() {
  const c = useCRM(),
    data = useRows("/attention?entity_id=" + c.entity);
  return (
    <>
      <Status data={data} />
      <Panel title="Требует внимания">
        <Table
          rows={data.rows}
          columns={[
            { key: "title", label: "Сигнал" },
            { key: "detail", label: "Причина и цифры" },
            {
              key: "owner",
              label: "Ответственный",
              render: (r) =>
                c.meta.users?.find((u) => u.id === r.owner)?.name || "Владелец",
            },
            {
              key: "action",
              label: "",
              render: (r) => (
                <Button onClick={() => c.openPage(r.page)}>Разобрать</Button>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
function Policy() {
  const c = useCRM(),
    [form, setForm] = useState(false);
  return (
    <Panel
      title="Скидки и минимальная маржа"
      action={<Button onClick={() => setForm(true)}>Настроить</Button>}
    >
      <p className="notice">
        Сверх лимита сотрудник может сохранить черновик, но резерв потребует
        решения владельца. Если себестоимость неизвестна, проверка маржи требует
        согласования.
      </p>
      {form && (
        <RecordForm
          title="Ценовая политика"
          onClose={() => setForm(false)}
          fields={[
            field("seller", "Скидка продавца, %", "number", true, {
              min: 0,
              max: 100,
            }),
            field("manager", "Скидка менеджера, %", "number", true, {
              min: 0,
              max: 100,
            }),
            field("rep", "Скидка представителя, %", "number", true, {
              min: 0,
              max: 100,
            }),
            field("margin", "Минимальная маржа, %", "number", true, {
              min: 0,
              max: 100,
            }),
          ]}
          initial={{
            seller: c.meta.settings.discount_limits?.seller || 0,
            manager: c.meta.settings.discount_limits?.manager || 0,
            rep: c.meta.settings.discount_limits?.rep || 0,
            margin: c.meta.settings.min_margin_percent || 0,
          }}
          submit={async (b) => {
            await c.mutate(
              "/settings",
              {
                discount_limits: {
                  seller: Number(b.seller),
                  manager: Number(b.manager),
                  rep: Number(b.rep),
                },
                min_margin_percent: Number(b.margin),
              },
              "PATCH",
            );
            setForm(false);
          }}
        />
      )}
    </Panel>
  );
}
function Audit() {
  const data = useRows("/audit");
  return (
    <>
      <Status data={data} />
      <Panel title="Журнал важных действий">
        <Table
          rows={data.rows}
          columns={[
            {
              key: "created_at",
              label: "Время",
              render: (r) => date(r.created_at),
            },
            { key: "actor_id", label: "Автор" },
            { key: "action", label: "Действие" },
            { key: "object_type", label: "Документ" },
            { key: "object_id", label: "Номер / ID" },
            {
              key: "payload",
              label: "Изменения",
              render: (r) =>
                typeof r.payload === "string"
                  ? r.payload
                  : JSON.stringify(r.payload),
            },
          ]}
        />
      </Panel>
    </>
  );
}

function Rights() {
  const c = useCRM(),
    data = useRows("/user-permissions"),
    [form, setForm] = useState(null);
  const labels = {
    view_cost: "Просмотр закупочных цен",
    view_other_clients: "Просмотр чужих клиентов и заказов",
    change_prices: "Изменение каталога и цен в пределах роли",
    manual_discount: "Ручные скидки с проверкой лимитов",
    writeoff: "Списания и проведение пересчёта",
    returns: "Возвраты товаров и денег",
    export_data: "Экспорт отчётов",
  };
  return (
    <>
      <Status data={data} />
      <Panel title="Дополнительные права сотрудников">
        <p className="notice">
          Основные роли и доступ к организациям задаются на вкладке «Основное».
          Здесь можно ограничить действия внутри роли.
        </p>
        <Table
          rows={data.rows}
          columns={[
            { key: "name", label: "Сотрудник" },
            {
              key: "action",
              label: "",
              render: (r) =>
                !r.roles.includes("owner") && (
                  <Button onClick={() => setForm(r)}>Настроить права</Button>
                ),
            },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title={"Права: " + form.name}
          onClose={() => setForm(null)}
          initial={Object.fromEntries(
            Object.keys(labels).map((k) => [
              k,
              form.permissions[k] ??
                (["view_cost", "view_other_clients", "export_data"].includes(k)
                  ? form.roles.includes("accountant")
                  : true),
            ]),
          )}
          fields={Object.entries(labels).map(([key, label]) =>
            field(key, label, "checkbox", false),
          )}
          submit={async (permissions) => {
            await c.mutate("/user-permissions", {
              user_id: form.id,
              permissions,
            });
            setForm(null);
          }}
        />
      )}
    </>
  );
}

function ImportData() {
  const c = useCRM(),
    [kind, setKind] = useState("clients"),
    [rows, setRows] = useState([]),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const templates = {
    clients: ["name", "kind", "phone", "inn", "address", "email"],
    balances: [
      "sku",
      "qty",
      "cost_cents",
      "batch_number",
      "expires_at",
      "reason",
    ],
    debts: ["client_id", "amount_cents", "due_date", "reason"],
    prices: ["sku", "retail_cents", "wholesale_cents"],
  };
  const body = { kind, entity_id: c.entity, warehouse_id: c.warehouse, rows };
  return (
    <Panel title="Перенос данных из таблиц">
      <div className="drawer-body">
        <p>
          CSV UTF-8 с разделителем ; или , из Excel. Суммы в копейках,
          количества в штуках. Импорт остатков добавляет приход, а не заменяет
          текущий остаток. Сначала сверяйте файл с блокнотом.
        </p>
        <Select
          label="Что переносим"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPreview(null);
            setRows([]);
          }}
          options={[
            { value: "clients", label: "Клиенты" },
            { value: "balances", label: "Начальные остатки" },
            { value: "debts", label: "Начальные долги" },
            { value: "prices", label: "Обновление цен" },
          ]}
        />
        <div className="actions wrap">
          <Button
            onClick={() => csvDownload("Шаблон " + kind, [templates[kind]])}
          >
            Скачать шаблон
          </Button>
          {kind === "debts" && (
            <Button
              onClick={() =>
                csvDownload("Идентификаторы клиентов", [
                  ["client_id", "name"],
                  ...(c.data.clients || []).map((x) => [x.id, x.name]),
                ])
              }
            >
              ID клиентов
            </Button>
          )}
        </div>
        <Field
          key={kind}
          label="Файл CSV"
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            setPreview(null);
            setError("");
            try {
              setRows(parseCsv(await e.target.files[0].text()));
            } catch (e) {
              setError(e.message);
            }
          }}
        />
        <p>Строк: {rows.length}</p>
        {error && <p className="error-box">{error}</p>}
        {preview && (
          <>
            <p>
              {preview.errors.length
                ? "Обнаружены ошибки. Данные не сохранены."
                : "Проверка пройдена. До подтверждения данные не изменяются."}
            </p>
            <Table
              rows={preview.errors.map((r) => ({ ...r, id: r.row }))}
              columns={[
                { key: "row", label: "Строка CSV" },
                { key: "error", label: "Ошибка" },
              ]}
            />
          </>
        )}
        <footer className="form-actions">
          <Button
            busy={busy}
            disabled={!rows.length}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setPreview(
                  await api("/imports/preview", { method: "POST", body }),
                );
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Проверить файл
          </Button>
          <Button
            primary
            busy={busy}
            disabled={!preview || preview.errors.length > 0}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await c.mutate("/imports/commit", {
                  ...body,
                  preview_hash: preview.preview_hash,
                });
                setPreview(null);
                setRows([]);
                c.setToast("Импорт проведён");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Подтвердить импорт
          </Button>
        </footer>
      </div>
    </Panel>
  );
}

function Plans() {
  const c = useCRM(),
    data = useRows("/plans?entity_id=" + c.entity),
    [form, setForm] = useState(false);
  return (
    <>
      <Status data={data} />
      <Panel
        title="План и фактические продажи"
        action={
          c.has() && (
            <Button primary onClick={() => setForm(true)}>
              Установить план
            </Button>
          )
        }
      >
        <p className="notice">
          Факт = отгрузки минус возвраты за период. Личный результат относится к
          автору заказа. План организации не складывается с личными планами.
        </p>
        <Table
          rows={data.rows}
          columns={[
            {
              key: "employee_name",
              label: "Ответственный",
              render: (r) => r.employee_name || "Вся организация",
            },
            { key: "starts_at", label: "С" },
            { key: "ends_at", label: "По" },
            {
              key: "amount_cents",
              label: "План",
              render: (r) => money(r.amount_cents),
            },
            {
              key: "actual_cents",
              label: "Факт",
              render: (r) => money(r.actual_cents),
            },
            {
              key: "percent",
              label: "Выполнение",
              render: (r) =>
                Math.round((r.actual_cents / r.amount_cents) * 100) + "%",
            },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title="План продаж"
          onClose={() => setForm(false)}
          fields={[
            field(
              "user_id",
              "Сотрудник (пусто = вся организация)",
              "select",
              false,
              { options: opts(c.meta.users || []) },
            ),
            field("starts_at", "Начало", "date"),
            field("ends_at", "Окончание", "date"),
            amount,
          ]}
          submit={async (b) => {
            await c.mutate("/plans", {
              ...b,
              entity_id: c.entity,
              amount_cents: cents(b.amount),
            });
            setForm(false);
          }}
        />
      )}
    </>
  );
}
function OperationalReports() {
  const c = useCRM(),
    [from, setFrom] = useState(localDay().slice(0, 7) + "-01"),
    [to, setTo] = useState(localDay()),
    [tab, setTab] = useState("customers"),
    data = useRows(
      "/reports/operations?" +
        new URLSearchParams({ entity_id: c.entity, from, to }),
    );
  const sets = {
    customers: [
      { key: "name", label: "Клиент" },
      { key: "period_orders", label: "Заказов за период" },
      {
        key: "last_purchase",
        label: "Последняя покупка",
        render: (r) => date(r.last_purchase),
      },
      {
        key: "average_cents",
        label: "Средний заказ",
        render: (r) => emptyMoney(r.average_cents),
      },
      { key: "interval_days", label: "Интервал, дней" },
      {
        key: "late",
        label: "Активность",
        render: (r) => (r.late ? "Пропущен привычный срок" : "Без сигнала"),
      },
      { key: "debt_cents", label: "Долг", render: (r) => money(r.debt_cents) },
    ],
    inventory: [
      { key: "name", label: "Товар" },
      {
        key: "warehouse_id",
        label: "Склад",
        render: (r) =>
          c.meta.warehouses.find((w) => w.id === r.warehouse_id)?.name,
      },
      { key: "available", label: "Доступно" },
      { key: "reserved", label: "Резерв" },
      { key: "sold", label: "Продано" },
      { key: "days_cover", label: "Запаса на дней" },
      {
        key: "last_shipment",
        label: "Последняя отгрузка",
        render: (r) => date(r.last_shipment),
      },
      { key: "observed_zero_days", label: "Дней без остатка" },
      { key: "observed_days", label: "Дней наблюдений" },
    ],
    deliveries: [
      { key: "number", label: "Заказ" },
      { key: "courier_name", label: "Курьер" },
      {
        key: "status",
        label: "Состояние",
        render: (r) =>
          ({
            awaiting: "Ожидает",
            assigned: "Назначена",
            in_transit: "В пути",
            delivered: "Доставлена",
            failed: "Неудачная попытка",
          })[r.status],
      },
      {
        key: "late",
        label: "Срок",
        render: (r) =>
          r.late == null ? "Срок не задан" : r.late ? "Задержка" : "В срок",
      },
      {
        key: "cost_cents",
        label: "Расходы",
        render: (r) => emptyMoney(r.cost_cents),
      },
      { key: "reason", label: "Причина" },
    ],
  };
  return (
    <>
      <div className="toolbar">
        <Field
          type="date"
          label="С"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          type="date"
          label="По"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Select
          label="Отчёт"
          value={tab}
          onChange={(e) => setTab(e.target.value)}
          options={[
            { value: "customers", label: "Активность клиентов" },
            { value: "inventory", label: "Оборачиваемость и наличие" },
            { value: "deliveries", label: "Доставка" },
          ]}
        />
      </div>
      <Status data={data} />
      <Panel title="Операционные показатели">
        <p className="notice">
          Продажи: {emptyMoney(data.rows.current?.sales_cents)}. За
          предшествующий период такой же длительности:{" "}
          {emptyMoney(data.rows.previous?.sales_cents)}. Валовая прибыль:{" "}
          {emptyMoney(data.rows.current?.gross_profit_cents)} /{" "}
          {emptyMoney(data.rows.previous?.gross_profit_cents)}.
        </p>
        {tab === "inventory" && (
          <p className="notice">{data.rows.stock_note}</p>
        )}
        <Table rows={data.rows[tab] || []} columns={sets[tab]} />
      </Panel>
    </>
  );
}
function DeliveryDetails() {
  const c = useCRM(),
    data = useRows("/delivery-details?entity_id=" + c.entity),
    [form, setForm] = useState(null);
  return (
    <>
      <Status data={data} />
      <Panel title="Сроки и стоимость доставки">
        <p className="notice">
          Стоимость доставки хранится отдельно от суммы товаров. Расходы здесь
          служат аналитике доставки; фактическую выплату бухгалтер отражает в
          расходах. Указание суммы не подтверждает оплату.
        </p>
        <Table
          rows={data.rows}
          columns={[
            { key: "number", label: "Заказ" },
            {
              key: "deadline_at",
              label: "Доставить до",
              render: (r) => date(r.deadline_at),
            },
            {
              key: "fee_cents",
              label: "Стоимость клиенту",
              render: (r) => money(r.fee_cents),
            },
            {
              key: "delivered_at",
              label: "Доставлено",
              render: (r) => date(r.delivered_at),
            },
            {
              key: "action",
              label: "",
              render: (r) =>
                c.has("dispatcher") && (
                  <Button onClick={() => setForm(r)}>Уточнить</Button>
                ),
            },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title={"Условия доставки " + form.number}
          onClose={() => setForm(null)}
          initial={{
            fee: (form.fee_cents || 0) / 100,
            cost: (form.cost_cents || 0) / 100,
          }}
          fields={[
            field(
              "deadline_at",
              "Доставить до (местное время устройства)",
              "datetime-local",
              false,
            ),
            field("fee", "Стоимость клиенту, ₽", "number", true, {
              min: 0,
              step: 0.01,
            }),
            ...(c.has("accountant")
              ? [
                  field("cost", "Расходы доставки, ₽", "number", true, {
                    min: 0,
                    step: 0.01,
                  }),
                ]
              : []),
          ]}
          submit={async (b) => {
            await c.mutate("/deliveries/" + form.id + "/details", {
              fee_cents: Math.round(Number(b.fee) * 100),
              ...(c.has("accountant")
                ? { cost_cents: Math.round(Number(b.cost) * 100) }
                : {}),
              deadline_at: b.deadline_at
                ? new Date(b.deadline_at).toISOString()
                : null,
            });
            setForm(null);
          }}
        />
      )}
    </>
  );
}

function Digest() {
  const c = useCRM(),
    data = useRows("/owner-digests?entity_id=" + c.entity),
    [form, setForm] = useState(false);
  return (
    <>
      <Status data={data} />
      <Panel
        title="Ежедневная сводка владельцу"
        action={<Button onClick={() => setForm(true)}>Расписание</Button>}
      >
        <p className="notice">
          Только внутри CRM. По умолчанию - после 09:00 по Астрахани, пока
          сервер включён. Обороты за предыдущий день, число дефицитных позиций
          на момент формирования. Одна сводка в день.
        </p>
        <Table
          rows={data.rows}
          columns={[
            {
              key: "created_at",
              label: "Сформирована",
              render: (r) => date(r.created_at),
            },
            { key: "period_from", label: "За день" },
            {
              key: "sales_cents",
              label: "Продажи",
              render: (r) => emptyMoney(r.sales_cents),
            },
            {
              key: "gross_profit_cents",
              label: "Валовая прибыль",
              render: (r) => emptyMoney(r.gross_profit_cents),
            },
            {
              key: "receipts_cents",
              label: "Получено денег",
              render: (r) => money(r.receipts_cents),
            },
            { key: "low_stock", label: "Низких остатков" },
          ]}
        />
      </Panel>
      {form && (
        <RecordForm
          title="Расписание сводки"
          initial={{
            digest_hour: c.meta.settings.digest_hour ?? 9,
            digest_enabled: c.meta.settings.digest_enabled !== false,
          }}
          fields={[
            field("digest_enabled", "Формировать сводку", "checkbox", false),
            field("digest_hour", "Час по Астрахани", "number", true, {
              min: 0,
              max: 23,
              step: 1,
            }),
          ]}
          onClose={() => setForm(false)}
          submit={async (b) => {
            await c.mutate(
              "/settings",
              { ...b, digest_hour: Number(b.digest_hour) },
              "PATCH",
            );
            setForm(false);
          }}
        />
      )}
    </>
  );
}

function ProductPhotos() {
  const c = useCRM(),
    [product, setProduct] = useState(null),
    [image, setImage] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Panel title="Фотографии товаров">
        <Table
          rows={c.data.products || []}
          columns={[
            { key: "sku", label: "Артикул" },
            { key: "name", label: "Товар" },
            {
              key: "action",
              label: "",
              render: (r) => (
                <Button
                  onClick={async () => {
                    setProduct(r);
                    setImage(null);
                    setError("");
                    try {
                      const result = await api("/products/" + r.id + "/photo");
                      setImage(result.image);
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Фотография
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {product && (
        <Drawer title={product.name} onClose={() => setProduct(null)}>
          <div className="drawer-body">
            {image ? (
              <img
                style={{
                  display: "block",
                  width: "100%",
                  maxHeight: 360,
                  objectFit: "contain",
                }}
                src={image}
                alt={product.name}
              />
            ) : (
              <Empty title="Фото не добавлено" />
            )}
            {c.has() && (
              <>
                <Field
                  label="Фото JPG, PNG или WebP до 400 КБ"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    setError("");
                    if (file.size > 409600) {
                      setError(
                        "Фото больше 400 КБ. Подготовьте уменьшенный файл.",
                      );
                      return;
                    }
                    try {
                      const value = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      });
                      setImage(value);
                    } catch {
                      setError("Не удалось прочитать фото");
                    }
                  }}
                />
                <footer className="form-actions">
                  <Button
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await c.mutate("/products/" + product.id + "/photo", {
                          image: null,
                        });
                        setImage(null);
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Удалить
                  </Button>
                  <Button
                    primary
                    busy={busy}
                    disabled={!image}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await c.mutate("/products/" + product.id + "/photo", {
                          image,
                        });
                        setProduct(null);
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Сохранить фото
                  </Button>
                </footer>
              </>
            )}
            {error && <p className="error-box">{error}</p>}
          </div>
        </Drawer>
      )}
    </>
  );
}

function Growth() {
  const c = useCRM();
  const data = useRows(
    "/reports/operations?" +
      new URLSearchParams({
        entity_id: c.entity,
        from: localDay().slice(0, 7) + "-01",
        to: localDay(),
      }),
  );
  const sales = useRows(
    "/reports/detail?" +
      new URLSearchParams({
        entity_id: c.entity,
        from: localDay().slice(0, 7) + "-01",
        to: localDay(),
      }),
  );
  const opportunities = [
    ...(data.rows.inventory || [])
      .filter((r) => r.sold > 0 && r.available < 50)
      .map((r) => ({
        id: "stock-" + r.product_id + "-" + r.warehouse_id,
        name: r.name,
        reason: `Продано ${r.sold} шт. за текущий месяц; доступно ${r.available} шт. Порог проверки: 50 шт.`,
        action: "Проверить запас",
        page: "stock",
        q: r.name,
      })),
    ...(sales.rows.products || [])
      .filter(
        (r) =>
          r.sales_cents > 0 &&
          r.gross_profit_cents != null &&
          r.gross_profit_cents / r.sales_cents < 0.2,
      )
      .map((r) => ({
        id: "margin-" + r.id,
        name: r.name,
        reason: `Продажи ${money(r.sales_cents)}, валовая прибыль ${money(r.gross_profit_cents)}. Маржа ${((100 * r.gross_profit_cents) / r.sales_cents).toFixed(1)}% ниже порога проверки 20%.`,
        action: "Проверить цену",
        page: "products",
        q: r.name,
      })),
    ...(data.rows.customers || [])
      .filter((r) => r.late)
      .map((r) => ({
        id: "client-" + r.id,
        name: r.name,
        reason: `Пропущен привычный срок заказа; последний заказ ${date(r.last_purchase)}.`,
        action: "Открыть клиента",
        page: "clients",
        q: r.name,
      })),
  ];
  return (
    <>
      <Status data={data} />
      <Status data={sales} />
      <Panel title="Точки роста за текущий месяц">
        <p className="notice">
          Рекомендации для проверки: пополнить продающийся товар, пересмотреть
          низкую маржу или связаться с клиентом. Пороги 50 шт. и 20% - ориентиры
          этого отчёта, а не гарантия роста. Отсутствие продаж не доказывает
          отсутствие спроса. Суммы раскрываются во вкладке «Товары» до
          документов.
        </p>
        <div className="bm-desktop-table">
          <Table
            rows={opportunities}
            empty="По этим правилам точек роста пока не найдено. Нужна история продаж и наличия."
            columns={[
              { key: "name", label: "Товар или клиент" },
              { key: "reason", label: "Почему стоит проверить" },
              {
                key: "action",
                label: "Действие",
                render: (r) => (
                  <Button onClick={() => c.openPage(r.page, { q: r.q })}>
                    {r.action}
                  </Button>
                ),
              },
            ]}
          />
        </div>
        <div className="bm-mobile-list">
          {opportunities.length ? (
            opportunities.map((r) => (
              <article key={r.id}>
                <strong>{r.name}</strong>
                <p>{r.reason}</p>
                <Button onClick={() => c.openPage(r.page, { q: r.q })}>
                  {r.action}
                </Button>
              </article>
            ))
          ) : (
            <Empty>По этим правилам точек роста пока не найдено.</Empty>
          )}
        </div>
      </Panel>
      <Attention />
    </>
  );
}
