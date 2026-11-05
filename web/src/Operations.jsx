import { PurchaseReceive } from "./TradingWorkspace.jsx";
import React, { useEffect, useState } from "react";
import { Plus, Download, Phone, MapPin, ArrowRight, Check } from "lucide-react";
import { useCRM } from "./App.jsx";
import { api, cents, money, date, labelStatus, csvDownload } from "./api.js";
import { exportXlsx } from "./export-xlsx.mjs";
import {
  Button,
  Panel,
  PageHeading,
  Table,
  RecordForm,
  Drawer,
  Field,
  Select,
  Badge,
  Empty,
} from "./ui.jsx";
const f = (key, label, type = "text", required = false, extra = {}) => ({
  key,
  label,
  type,
  required,
  ...extra,
});
export function PaymentForm({ order, onClose }) {
  const c = useCRM();
  const finance = c.has("accountant");
  const fields = [
    f("order_id", "Основание: заказ", "select", !finance, {
      options: (order ? [order] : c.data.orders || [])
        .filter(
          (o) =>
            o.status !== "draft" &&
            (o.status !== "cancelled" || o.shipped_cents > o.returned_cents),
        )
        .map((o) => ({
          id: o.id,
          name:
            "№ " +
            o.number +
            " · " +
            (o.client_name || "Розница") +
            " · " +
            money(o.total_cents),
        })),
    }),
    f("amount", "Подтверждённая сумма, ₽", "text", true),
    f("method", "Способ оплаты", "select", true, {
      options: [
        { value: "cash", label: "Наличные" },
        ...(finance ? [{ value: "bank", label: "Безналичный платёж" }] : []),
      ],
    }),
    f("reference", "Основание подтверждения / номер документа", "text", false, {
      hint: "Для безналичной оплаты обязательно",
    }),
    f("note", "Комментарий", "textarea"),
  ];
  return (
    <RecordForm
      title="Записать подтверждённую оплату"
      initial={{
        order_id: order?.id || "",
        amount: order
          ? String(
              Math.max(
                0,
                (order.status === "cancelled"
                  ? order.shipped_cents
                  : order.total_cents) -
                  (order.returned_cents || 0) -
                  (order.paid_cents || 0) +
                  (order.refunded_cents || 0),
              ) / 100,
            )
          : "",
        method: "cash",
      }}
      fields={fields}
      hint="Записывайте только фактически полученные деньги. CRM не списывает средства с карты и не выдаёт фискальный чек. Сбор наличных сотрудником и сдача денег учитываются отдельно."
      submitLabel="Подтвердить факт оплаты"
      onClose={onClose}
      submit={async (v) => {
        const selected =
          (c.data.orders || []).find((o) => o.id === v.order_id) || order;
        if (v.method === "bank" && !v.reference?.trim())
          throw new Error(
            "Укажите документ, подтверждающий безналичный платёж.",
          );
        await c.mutate("/payments", {
          entity_id: selected?.entity_id || c.entity,
          order_id: v.order_id || undefined,
          client_id: selected?.client_id || undefined,
          amount_cents: cents(v.amount),
          method: v.method,
          reference: v.reference,
          note: v.note,
        });
        c.setToast("Подтверждённая оплата записана");
      }}
    />
  );
}
export function Finance() {
  const c = useCRM(),
    [tab, setTab] = useState("payments"),
    [form, setForm] = useState(null),
    [error, setError] = useState("");
  const finance = c.has("accountant");
  const cash = c.data.cash || { balances: [], handovers: [] };
  const ownBalance = cash.balances.filter((x) => x.entity_id === c.entity);
  const data = (Array.isArray(c.data[tab]) ? c.data[tab] : []).filter(
    (x) => !x.entity_id || x.entity_id === c.entity,
  );
  const configs = {
    allocate: {
      title: "Распределить поступление",
      fields: [
        f("payment_id", "Поступление", "select", true, {
          options: (c.data.payments || [])
            .filter(
              (p) =>
                p.amount_cents -
                  (p.opening_allocated_cents || 0) -
                  (p.allocations || []).reduce(
                    (n, a) => n + a.amount_cents,
                    0,
                  ) >
                0,
            )
            .map((p) => ({
              id: p.id,
              name:
                date(p.created_at) +
                " · свободно " +
                money(
                  p.amount_cents -
                    (p.opening_allocated_cents || 0) -
                    (p.allocations || []).reduce(
                      (n, a) => n + a.amount_cents,
                      0,
                    ),
                ),
            })),
        }),
        f("order_id", "Заказ", "select", true, {
          options: (c.data.orders || [])
            .filter((o) => o.status !== "draft")
            .map((o) => ({
              id: o.id,
              name: "№ " + o.number + " · " + (o.client_name || "Розница"),
            })),
        }),
        f("amount", "Зачесть, ₽", "text", true),
      ],
      hint: "Распределение связывает уже полученные деньги с заказом и не создаёт новое поступление.",
    },
    expense: {
      title: "Расход",
      fields: [
        f("amount", "Сумма, ₽", "text", true),
        f("category", "Категория", "text", true),
        f("date", "Дата", "date", true),
        f("note", "Основание / комментарий", "textarea", true),
      ],
      initial: { date: new Date().toISOString().slice(0, 10) },
      url: "/expenses",
    },
    handover: {
      title: "Сдать наличные",
      fields: [
        f("amount", "Сумма к сдаче, ₽", "text", true),
        f("note", "Комментарий", "textarea"),
      ],
      hint: "Сдачу подтвердит другой сотрудник, фактически принявший деньги. До подтверждения сумма остаётся у вас.",
      url: "/cash/handovers",
    },
    refund: {
      title: "Возврат денег",
      fields: [
        f("order_id", "Заказ", "select", true, {
          options: (c.data.orders || []).map((o) => ({
            id: o.id,
            name: "№ " + o.number + " · " + (o.client_name || "Розница"),
          })),
        }),
        f("amount", "Сумма, ₽", "text", true),
        f("method", "Способ", "select", true, {
          options: [
            { value: "cash", label: "Наличные" },
            { value: "bank", label: "Безналично" },
          ],
        }),
        f("reason", "Причина", "textarea", true),
      ],
      url: "/refunds",
      hint: "Запишите фактический возврат денег. Возврат товара оформляется отдельно в заказе.",
    },
  };
  return (
    <>
      <PageHeading>
        <div>
          <h1>Деньги</h1>
          <p>Подтверждённые операции выбранной организации</p>
        </div>
        <div className="actions">
          {c.has("seller", "rep", "accountant") && (
            <Button primary onClick={() => setForm("payment")}>
              <Plus size={16} />
              Оплата
            </Button>
          )}
          {finance && (
            <Button onClick={() => setForm("expense")}>Расход</Button>
          )}
        </div>
      </PageHeading>
      <div className="tabs">
        {[
          ["payments", "Поступления"],
          ["cash", "Наличные у сотрудников"],
          ...(finance ? [["expenses", "Расходы"]] : []),
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <div className="error-box">{error}</div>}
      {tab === "cash" ? (
        <>
          <Panel
            title="Несданные наличные"
            action={
              c.has("rep", "courier") && (
                <Button onClick={() => setForm("handover")}>
                  Оформить сдачу
                </Button>
              )
            }
          >
            <Table
              rows={ownBalance}
              empty="Несданных наличных в этой организации пока нет."
              columns={[
                { key: "name", label: "Сотрудник" },
                {
                  key: "amount_cents",
                  label: "У сотрудника",
                  numeric: true,
                  render: (r) => money(r.amount_cents),
                },
              ]}
            />
          </Panel>
          <Panel title="Передачи денег">
            <Table
              rows={cash.handovers.filter((h) => h.entity_id === c.entity)}
              columns={[
                {
                  key: "created_at",
                  label: "Дата",
                  render: (r) => date(r.created_at),
                },
                {
                  key: "user_id",
                  label: "Сдающий",
                  render: (r) =>
                    c.meta.users.find((u) => u.id === r.user_id)?.name ||
                    "Сотрудник",
                },
                {
                  key: "amount_cents",
                  label: "Сумма",
                  numeric: true,
                  render: (r) => money(r.amount_cents),
                },
                {
                  key: "status",
                  label: "Состояние",
                  render: (r) => (
                    <Badge status={r.status}>{labelStatus(r.status)}</Badge>
                  ),
                },
                {
                  key: "action",
                  label: "",
                  render: (r) =>
                    r.status === "pending" &&
                    r.user_id !== c.auth.id &&
                    c.has("accountant", "seller") ? (
                      <Button onClick={() => setForm({ confirm: r })}>
                        Принять деньги
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Panel>
        </>
      ) : (
        <Panel
          title={tab === "payments" ? "Поступления" : "Расходы"}
          action={
            finance &&
            tab === "payments" && (
              <div className="actions">
                <Button onClick={() => setForm("allocate")}>
                  Распределить
                </Button>
                <Button onClick={() => setForm("refund")}>Возврат денег</Button>
              </div>
            )
          }
        >
          <Table
            rows={data}
            columns={[
              {
                key: "created_at",
                label: "Дата",
                render: (r) => date(r.created_at || r.date),
              },
              {
                key: "amount_cents",
                label: "Сумма",
                numeric: true,
                render: (r) => money(r.amount_cents),
              },
              {
                key: "method",
                label: tab === "payments" ? "Способ" : "Категория",
                render: (r) =>
                  r.method
                    ? r.method === "cash"
                      ? "Наличные"
                      : "Безналичный платёж"
                    : r.category,
              },
              {
                key: "reference",
                label: "Основание",
                render: (r) => r.reference || r.note || "Не указано",
              },
              {
                key: "fiscal_status",
                label: tab === "payments" ? "Фискальный чек" : "",
                render: (r) =>
                  tab === "payments" ? (
                    <span className="muted">
                      Не сформирован: касса не подключена
                    </span>
                  ) : null,
              },
            ]}
          />
        </Panel>
      )}
      {form === "payment" && <PaymentForm onClose={() => setForm(null)} />}{" "}
      {typeof form === "string" && configs[form] && (
        <RecordForm
          {...configs[form]}
          onClose={() => setForm(null)}
          submit={async (v) => {
            if (form === "allocate")
              await c.mutate("/payments/" + v.payment_id + "/allocate", {
                allocations: [
                  { order_id: v.order_id, amount_cents: cents(v.amount) },
                ],
              });
            else
              await c.mutate(configs[form].url, {
                ...v,
                entity_id: c.entity,
                amount_cents: cents(v.amount),
              });
            c.setToast("Операция сохранена");
          }}
        />
      )}
      {form?.confirm && (
        <RecordForm
          title="Подтвердить приём наличных"
          fields={[]}
          hint={
            "Подтвердите, что фактически получили " +
            money(form.confirm.amount_cents) +
            ". Это не новая оплата покупателя."
          }
          submitLabel="Деньги получены"
          onClose={() => setForm(null)}
          submit={async () => {
            await c.mutate("/cash/handovers/" + form.confirm.id + "/confirm");
            c.setToast("Сдача подтверждена");
          }}
        />
      )}
    </>
  );
}
export function Deliveries() {
  const c = useCRM(),
    [edit, setEdit] = useState(null),
    [progress, setProgress] = useState(null);
  const manage = c.has("dispatcher");
  const rows = (c.data.deliveries || []).filter(
    (d) => !d.entity_id || d.entity_id === c.entity,
  );
  const fields = [
    f("order_id", "Заказ", "select", true, {
      options: (c.data.orders || [])
        .filter((o) => o.status !== "draft" && o.status !== "cancelled")
        .map((o) => ({
          id: o.id,
          name: "№ " + o.number + " · " + (o.client_name || "Без имени"),
        })),
    }),
    f("courier_id", "Курьер", "select", false, {
      options: c.meta.users.filter((u) => u.roles?.includes("courier")),
    }),
    f("address", "Адрес", "text", true),
    f("phone", "Телефон", "tel", true),
    f("interval", "Интервал доставки"),
    f("collect_on_delivery", "Оплата курьеру при вручении", "checkbox"),
    f("places", "Количество мест", "number", true, { min: 1, step: 1 }),
    f("note", "Примечание", "textarea"),
  ];
  return (
    <>
      <PageHeading>
        <div>
          <h1>{manage ? "Доставка" : "Мои доставки"}</h1>
          <p>Назначения и вручение. Оплата не меняется от статуса доставки.</p>
        </div>
        {manage && (
          <Button primary onClick={() => setEdit({ places: 1 })}>
            <Plus size={16} />
            Доставка
          </Button>
        )}
      </PageHeading>
      {!rows.length ? (
        <Panel>
          <Empty title="Доставок пока нет">
            {manage
              ? "Создайте доставку для подтверждённого заказа."
              : "Назначенные вам задания появятся здесь."}
          </Empty>
        </Panel>
      ) : (
        <div className="delivery-grid">
          {rows.map((d) => (
            <Panel
              key={d.id}
              title={
                "Заказ " +
                (d.order_number ||
                  c.data.orders?.find((o) => o.id === d.order_id)?.number ||
                  "")
              }
              action={<Badge status={d.status}>{labelStatus(d.status)}</Badge>}
            >
              <div className="panel-body">
                <h3>{d.address}</h3>
                <p>{d.interval || "Интервал не задан"}</p>
                <div className="actions">
                  <a className="button" href={"tel:" + d.phone}>
                    <Phone size={16} />
                    Позвонить
                  </a>
                  <a
                    className="button"
                    href={
                      "https://yandex.ru/maps/?text=" +
                      encodeURIComponent(d.address)
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin size={16} />
                    Карта
                  </a>
                </div>
                <dl className="details-list">
                  <div>
                    <dt>Мест</dt>
                    <dd>{d.places}</dd>
                  </div>
                  <div>
                    <dt>
                      {d.collect_on_delivery
                        ? "Получить при вручении"
                        : "Осталось оплатить"}
                    </dt>
                    <dd>{money(d.amount_due_cents)}</dd>
                  </div>
                  <div>
                    <dt>Курьер</dt>
                    <dd>
                      {c.meta.users.find((u) => u.id === d.courier_id)?.name ||
                        "Не назначен"}
                    </dd>
                  </div>
                </dl>
                {d.note && <p>{d.note}</p>}
                {d.reason && <p className="warning">{d.reason}</p>}
                <div className="actions wrap">
                  {manage && !["delivered", "failed"].includes(d.status) && (
                    <Button onClick={() => setEdit(d)}>Назначение</Button>
                  )}
                  {!["delivered", "failed"].includes(d.status) && (
                    <Button primary onClick={() => setProgress(d)}>
                      Результат доставки
                    </Button>
                  )}
                  {c.has("courier") && d.amount_due_cents > 0 && (
                    <Button
                      onClick={async () => {
                        try {
                          const order = await api("/orders/" + d.order_id);
                          setProgress({ ...d, payment: true, order });
                        } catch (e) {
                          c.setToast(e.message);
                        }
                      }}
                    >
                      Принять наличные
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
      {edit && (
        <RecordForm
          title={edit.id ? "Назначение курьера" : "Новая доставка"}
          fields={
            edit.id
              ? fields.filter((f) => ["courier_id", "note"].includes(f.key))
              : fields
          }
          initial={edit}
          onClose={() => setEdit(null)}
          submit={async (v) => {
            await c.mutate(
              "/deliveries" + (edit.id ? "/" + edit.id : ""),
              edit.id
                ? {
                    courier_id: v.courier_id,
                    note: v.note,
                    status: v.courier_id ? "assigned" : "awaiting",
                  }
                : { ...v, places: Number(v.places) },
              edit.id ? "PATCH" : "POST",
            );
            c.setToast("Доставка сохранена");
          }}
        />
      )}
      {progress && !progress.payment && (
        <RecordForm
          title="Результат доставки"
          initial={{
            status: progress.status === "assigned" ? "in_transit" : "delivered",
          }}
          fields={[
            f("status", "Статус", "select", true, {
              options: [
                { value: "in_transit", label: "В пути" },
                { value: "delivered", label: "Доставлено" },
                { value: "failed", label: "Не удалось доставить" },
              ],
            }),
            f("reason", "Причина / пояснение", "textarea", false, {
              when: (v) => v.status === "failed",
            }),
            f("note", "Комментарий", "textarea"),
          ]}
          hint="Вручение не подтверждает оплату. Приём наличных запишите отдельно."
          onClose={() => setProgress(null)}
          submit={async (v) => {
            if (v.status === "failed" && !v.reason?.trim())
              throw new Error("Укажите причину неудачной доставки");
            await c.mutate("/deliveries/" + progress.id, v, "PATCH");
          }}
        />
      )}
      {progress?.payment && (
        <PaymentForm order={progress.order} onClose={() => setProgress(null)} />
      )}
    </>
  );
}
export function Visits() {
  const c = useCRM(),
    [form, setForm] = useState(null),
    [promotion, setPromotion] = useState(false);
  const visits = c.data.visits || [],
    cash =
      c.data.cash?.balances?.filter(
        (b) => b.user_id === c.auth.id && b.entity_id === c.entity,
      ) || [];
  return (
    <>
      <PageHeading>
        <div>
          <h1>Мой день</h1>
          <p>Визиты, клиенты и следующие действия</p>
        </div>
        <Button primary onClick={() => setForm({})}>
          <Plus size={16} />
          Запланировать визит
        </Button>
      </PageHeading>
      <div className="day-summary">
        <span>
          Запланировано:{" "}
          <strong>{visits.filter((v) => v.status === "planned").length}</strong>
        </span>
        <span>
          Завершено:{" "}
          <strong>
            {visits.filter((v) => v.status === "completed").length}
          </strong>
        </span>
        <Button onClick={() => c.openPage("orders")}>Новый заказ</Button>
        <Button onClick={() => c.openPage("finance")}>
          Мои наличные
          {cash.length
            ? " · " + money(cash.reduce((a, b) => a + b.amount_cents, 0))
            : ""}
        </Button>
      </div>
      <Panel title="Визиты">
        <div className="visit-list">
          {visits.length ? (
            visits.map((v) => (
              <div className="visit-row" key={v.id}>
                <div className="visit-date">{date(v.scheduled_at)}</div>
                <div>
                  <strong>{v.client_name}</strong>
                  <p>{v.note}</p>
                  {v.result && <p>{v.result}</p>}
                  {v.reason && <p>{v.reason}</p>}
                  {v.next_date && (
                    <small>Следующий контакт: {date(v.next_date)}</small>
                  )}
                  <Badge status={v.status}>{labelStatus(v.status)}</Badge>
                </div>
                {v.status === "planned" && (
                  <Button onClick={() => setForm(v)}>Результат визита</Button>
                )}
              </div>
            ))
          ) : (
            <Empty>Назначьте первый визит доступному клиенту.</Empty>
          )}
        </div>
      </Panel>
      <Panel
        title="Акции"
        action={
          c.has() && (
            <Button onClick={() => setPromotion(true)}>Создать акцию</Button>
          )
        }
      >
        {!c.data.promotions?.length ? (
          <Empty>Действующих записей об акциях пока нет.</Empty>
        ) : (
          <Table
            rows={c.data.promotions || []}
            columns={[
              { key: "name", label: "Акция" },
              {
                key: "discount_percent",
                label: "Скидка",
                render: (r) => r.discount_percent + "%",
              },
              {
                key: "starts_at",
                label: "С",
                render: (r) => date(r.starts_at),
              },
              { key: "ends_at", label: "До", render: (r) => date(r.ends_at) },
            ]}
          />
        )}
      </Panel>
      {form && (
        <RecordForm
          title={form.id ? "Результат визита" : "Новый визит"}
          fields={
            form.id
              ? [
                  f("status", "Результат", "select", true, {
                    options: [
                      { value: "completed", label: "Визит состоялся" },
                      { value: "cancelled", label: "Визит не состоялся" },
                    ],
                  }),
                  f(
                    "result",
                    "Итог встречи / причина отказа от заказа",
                    "textarea",
                    false,
                  ),
                  f("reason", "Причина отмены", "textarea", false, {
                    when: (v) => v.status === "cancelled",
                  }),
                  f("next_date", "Следующий контакт", "datetime-local"),
                ]
              : [
                  f("client_id", "Клиент", "select", true, {
                    options: (c.data.clients || []).filter(
                      (x) => x.kind !== "supplier",
                    ),
                  }),
                  f("scheduled_at", "Когда", "datetime-local", true),
                  f("note", "Задача визита", "textarea", true),
                ]
          }
          initial={form.id ? { status: "completed" } : {}}
          onClose={() => setForm(null)}
          submit={async (v) => {
            if (form.id && v.status === "completed" && !v.result?.trim())
              throw new Error("Опишите результат встречи");
            if (form.id && v.status === "cancelled" && !v.reason?.trim())
              throw new Error("Укажите причину");
            await c.mutate(
              "/visits" + (form.id ? "/" + form.id : ""),
              v,
              form.id ? "PATCH" : "POST",
            );
          }}
        />
      )}
      {promotion && <PromotionForm onClose={() => setPromotion(false)} />}
    </>
  );
}
function PromotionForm({ onClose }) {
  const c = useCRM(),
    [ids, setIds] = useState([]);
  return (
    <Drawer title="Новая акция" onClose={onClose}>
      <PromotionFields ids={ids} setIds={setIds} onClose={onClose} />
    </Drawer>
  );
}
function PromotionFields({ ids, setIds, onClose }) {
  const c = useCRM(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="drawer-body"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const v = Object.fromEntries(new FormData(e.currentTarget));
          await c.mutate("/promotions", {
            ...v,
            discount_percent: Number(v.discount_percent),
            product_ids: ids,
          });
          onClose();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field name="name" label="Название" required />
      <Field name="starts_at" type="datetime-local" label="Начало" required />
      <Field name="ends_at" type="datetime-local" label="Окончание" required />
      <Field
        name="discount_percent"
        type="number"
        min="0.01"
        max="100"
        step="0.01"
        label="Скидка, %"
        required
      />
      <fieldset>
        <legend>Товары акции</legend>
        {(c.data.products || []).map((p) => (
          <label key={p.id} className="check">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={(e) =>
                setIds(
                  e.target.checked
                    ? [...ids, p.id]
                    : ids.filter((id) => id !== p.id),
                )
              }
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      {error && <div className="error-box">{error}</div>}
      <Button primary busy={busy}>
        Создать акцию
      </Button>
    </form>
  );
}
export function Purchases() {
  const c = useCRM(),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState(null),
    [error, setError] = useState("");
  const rows = (c.data.purchases || []).filter(
    (p) => p.entity_id === c.entity && p.warehouse_id === c.warehouse,
  );
  return (
    <>
      <PageHeading>
        <div>
          <h1>Закупки</h1>
          <p>Заказы поставщикам и фактическая приёмка</p>
        </div>
        {c.has("accountant") && (
          <Button primary onClick={() => setCreating(true)}>
            <Plus size={16} />
            Закупка
          </Button>
        )}
      </PageHeading>
      {error && <div className="error-box">{error}</div>}
      <Panel>
        <Table
          rows={rows}
          empty="Создайте заказ поставщику. Остаток увеличится только после приёмки."
          columns={[
            {
              key: "created_at",
              label: "Создан",
              render: (r) => date(r.created_at),
            },
            {
              key: "supplier_id",
              label: "Поставщик",
              render: (r) =>
                c.data.clients?.find((x) => x.id === r.supplier_id)?.name ||
                "Не указан",
            },
            {
              key: "expected_at",
              label: "Ожидаем",
              render: (r) => date(r.expected_at),
            },
            {
              key: "status",
              label: "Статус",
              render: (r) => (
                <Badge status={r.status}>{labelStatus(r.status)}</Badge>
              ),
            },
            {
              key: "lines",
              label: "Позиций",
              render: (r) => r.lines?.length || 0,
            },
            {
              key: "action",
              label: "",
              render: (r) => (
                <Button onClick={() => setSelected(r)}>Открыть</Button>
              ),
            },
          ]}
        />
      </Panel>
      {creating && <PurchaseForm onClose={() => setCreating(false)} />}{" "}
      {selected && (
        <PurchaseReceive
          purchase={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function PurchaseForm({ onClose }) {
  const c = useCRM(),
    [lines, setLines] = useState([{ product_id: "", qty: 1, cost: "" }]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Drawer title="Закупка у поставщика" onClose={onClose} wide>
      <form
        className="drawer-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const v = Object.fromEntries(new FormData(e.currentTarget));
            await c.mutate("/purchases", {
              ...v,
              entity_id: c.entity,
              warehouse_id: c.warehouse,
              supplier_id: v.supplier_id || undefined,
              lines: lines.map((l) => ({
                ...l,
                qty: Number(l.qty),
                cost_cents: cents(l.cost),
              })),
            });
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Select
            name="supplier_id"
            label="Поставщик"
            options={(c.data.clients || []).filter(
              (x) => x.kind === "supplier",
            )}
          />
          <Field name="expected_at" label="Ожидаемая дата" type="date" />
        </div>
        {lines.map((l, i) => (
          <div className="purchase-line" key={i}>
            <Select
              label="Товар"
              required
              value={l.product_id}
              options={c.data.products || []}
              onChange={(e) =>
                setLines(
                  lines.map((x, n) =>
                    n === i ? { ...x, product_id: e.target.value } : x,
                  ),
                )
              }
            />
            <Field
              label="Штук"
              type="number"
              required
              min="1"
              step="1"
              value={l.qty}
              onChange={(e) =>
                setLines(
                  lines.map((x, n) =>
                    n === i ? { ...x, qty: e.target.value } : x,
                  ),
                )
              }
            />
            <Field
              label="Цена за шт., ₽"
              required
              value={l.cost}
              onChange={(e) =>
                setLines(
                  lines.map((x, n) =>
                    n === i ? { ...x, cost: e.target.value } : x,
                  ),
                )
              }
            />
            <Field
              label="Годен до"
              type="date"
              value={l.expires_at || ""}
              onChange={(e) =>
                setLines(
                  lines.map((x, n) =>
                    n === i ? { ...x, expires_at: e.target.value } : x,
                  ),
                )
              }
            />
            <Button
              type="button"
              disabled={lines.length === 1}
              onClick={() => setLines(lines.filter((_, n) => n !== i))}
            >
              Удалить
            </Button>
          </div>
        ))}
        <Button
          type="button"
          onClick={() =>
            setLines([...lines, { product_id: "", qty: 1, cost: "" }])
          }
        >
          Добавить позицию
        </Button>
        <Field name="notes" label="Комментарий" />
        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button primary type="submit" busy={busy}>
            Создать закупку
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
export function Overview({ reportOnly = false }) {
  const c = useCRM(),
    [tab, setTab] = useState("overview"),
    [period, setPeriod] = useState({ from: "", to: "" }),
    [custom, setCustom] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [drill, setDrill] = useState(null);
  useEffect(() => {
    setCustom(null);
  }, [c.entity, c.data.overview]);
  const report = custom || c.data.overview;
  const alerts = (c.data.alerts || []).filter(
    (a) => a.entity_id === c.entity && a.status !== "resolved",
  );
  const metric = (key) =>
    report?.[key] == null ? "Нет оценки" : money(report[key]);
  async function filter() {
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams({ entity_id: c.entity });
      if (period.from) q.set("from", period.from);
      if (period.to)
        q.set(
          "to",
          new Date(Date.parse(period.to + "T00:00:00Z") + 86400000)
            .toISOString()
            .slice(0, 10),
        );
      setCustom(await api("/reports/overview?" + q));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const headers = [
    "Артикул",
    "Товар",
    "Продано, шт.",
    "Продажи, ₽",
    "Себестоимость, ₽",
    "Валовая прибыль, ₽",
  ];
  const exportRows = (report?.products || []).map((p) => [
    p.sku,
    p.name,
    p.qty,
    p.sales_cents == null ? "Нет оценки" : p.sales_cents / 100,
    p.cost_cents == null ? "Нет оценки" : p.cost_cents / 100,
    p.gross_profit_cents == null ? "Нет оценки" : p.gross_profit_cents / 100,
  ]);
  return (
    <>
      <PageHeading>
        <div>
          <h1>{reportOnly ? "Аналитика" : "Рабочее место владельца"}</h1>
          <p>Продажи, деньги и решения по выбранной организации</p>
        </div>
      </PageHeading>
      {!reportOnly && (
        <div className="tabs">
          {[
            ["overview", "Обзор"],
            ["attention", "Требует внимания"],
            ["reports", "Подробные отчёты"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
              {id === "attention" && alerts.length > 0 && (
                <span className="count">{alerts.length}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {tab !== "attention" && (
        <div className="toolbar period">
          <Field
            label="С"
            type="date"
            value={period.from}
            onChange={(e) => setPeriod({ ...period, from: e.target.value })}
          />
          <Field
            label="По"
            type="date"
            value={period.to}
            onChange={(e) => setPeriod({ ...period, to: e.target.value })}
          />
          <Button onClick={filter} busy={busy}>
            Применить период
          </Button>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      {tab === "attention" ? (
        <Panel title="Низкие остатки">
          <Table
            rows={alerts}
            empty="Нет активных уведомлений о низком остатке."
            columns={[
              { key: "name", label: "Товар" },
              {
                key: "warehouse_id",
                label: "Склад",
                render: (r) =>
                  c.meta.warehouses.find((w) => w.id === r.warehouse_id)?.name,
              },
              { key: "available", label: "Доступно", numeric: true },
              { key: "threshold", label: "Порог", numeric: true },
              {
                key: "action",
                label: "",
                render: (r) =>
                  !r.read_at ? (
                    <Button
                      onClick={async () => {
                        try {
                          await c.mutate("/alerts/" + r.id + "/read");
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      Просмотрено
                    </Button>
                  ) : (
                    <span className="muted">Просмотрено</span>
                  ),
              },
            ]}
          />
          <div className="panel-body">
            <Button onClick={() => c.openPage("finance")}>
              Проверить несданные деньги
            </Button>
          </div>
        </Panel>
      ) : !report ? (
        <Panel>
          <Empty title="Нет доступа к данным отчёта">
            Проверьте организацию и обновите данные.
          </Empty>
        </Panel>
      ) : !report.has_data ? (
        <Panel>
          <Empty
            title="Начните с товаров и первого прихода"
            action={
              <div className="actions">
                <Button primary onClick={() => c.openPage("products")}>
                  Добавить товары
                </Button>
                <Button onClick={() => c.openPage("stock")}>
                  Оформить приход
                </Button>
              </div>
            }
          >
            Операций пока нет. После первой продажи здесь появятся суммы и
            исходные документы.
          </Empty>
        </Panel>
      ) : tab === "overview" ? (
        <>
          <div className="overview-grid">
            {[
              ["sales_cents", "Продажи", "Отгрузки за вычетом возвратов"],
              [
                "receipts_cents",
                "Получено от покупателей",
                "Подтверждённые поступления",
              ],
              [
                "gross_profit_cents",
                "Валовая прибыль",
                "Продажи минус себестоимость",
              ],
              ["debt_cents", "Долг покупателей", "На текущий момент"],
            ].map(([key, title, desc]) => (
              <div className="metric" key={key}>
                <span>{title}</span>
                <strong>{metric(key)}</strong>
                <small>{desc}</small>
                <button className="link" onClick={() => setDrill(key)}>
                  Показать исходные данные
                </button>
              </div>
            ))}
          </div>
          <div className="two-columns">
            <Panel title="Деньги и товар">
              <dl className="details-list panel-body">
                {[
                  ["cash_custody_cents", "Наличные у сотрудников"],
                  ["inventory_cents", "Стоимость запасов сейчас"],
                  ["expenses_cents", "Расходы за период"],
                  ["returns_cents", "Возвраты за период"],
                  ["writeoffs_cents", "Списания за период"],
                  ["overdue_cents", "Просроченный долг сейчас"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{metric(key)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel title="Следующие действия">
              <div className="panel-body stack">
                <Button onClick={() => setTab("attention")}>
                  Низкие остатки: {alerts.length}
                </Button>
                <Button onClick={() => c.openPage("finance")}>
                  Сверить деньги
                </Button>
                <Button onClick={() => c.openPage("orders")}>
                  Открыть заказы
                </Button>
                <p className="muted">
                  Валовая прибыль не является чистой прибылью. Неполная
                  себестоимость отображается без оценки.
                </p>
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <Panel
          title="Продажи по товарам"
          action={
            <div className="actions">
              <Button
                disabled={!c.meta.permissions.export_data}
                onClick={() => csvDownload("Продажи", [headers, ...exportRows])}
              >
                <Download size={16} />
                CSV
              </Button>
              <Button
                disabled={!c.meta.permissions.export_data}
                onClick={() => exportXlsx("Продажи", headers, exportRows)}
              >
                Excel
              </Button>
            </div>
          }
        >
          <Table
            rows={report.products || []}
            columns={[
              { key: "name", label: "Товар" },
              { key: "qty", label: "Штук", numeric: true },
              {
                key: "sales_cents",
                label: "Продажи",
                numeric: true,
                render: (r) =>
                  r.sales_cents == null ? "Нет оценки" : money(r.sales_cents),
              },
              {
                key: "cost_cents",
                label: "Себестоимость",
                numeric: true,
                render: (r) =>
                  r.cost_cents == null ? "Нет оценки" : money(r.cost_cents),
              },
              {
                key: "gross_profit_cents",
                label: "Валовая прибыль",
                numeric: true,
                render: (r) =>
                  r.gross_profit_cents == null
                    ? "Нет оценки"
                    : money(r.gross_profit_cents),
              },
            ]}
          />
        </Panel>
      )}
      {drill && (
        <Drawer title="Исходные операции" onClose={() => setDrill(null)} wide>
          <div className="drawer-body">
            {drill === "receipts_cents" ? (
              <Table
                rows={report.receipt_documents || []}
                columns={[
                  {
                    key: "created_at",
                    label: "Дата",
                    render: (r) => date(r.created_at),
                  },
                  {
                    key: "amount_cents",
                    label: "Поступило",
                    numeric: true,
                    render: (r) => money(r.amount_cents),
                  },
                  { key: "reference", label: "Основание" },
                ]}
              />
            ) : drill === "debt_cents" ? (
              <Table
                rows={report.debt_documents || []}
                columns={[
                  { key: "number", label: "Заказ" },
                  { key: "due_date", label: "Срок оплаты" },
                  {
                    key: "debt_cents",
                    label: "Долг сейчас",
                    numeric: true,
                    render: (r) => money(r.debt_cents),
                  },
                ]}
              />
            ) : (
              <Table
                rows={report.movements || []}
                columns={[
                  {
                    key: "created_at",
                    label: "Дата операции",
                    render: (r) => date(r.created_at),
                  },
                  {
                    key: "order_id",
                    label: "Заказ",
                    render: (r) =>
                      (report.documents || []).find((o) => o.id === r.order_id)
                        ?.number || r.order_id,
                  },
                  {
                    key: "kind",
                    label: "Операция",
                    render: (r) => (r.kind === "ship" ? "Отгрузка" : "Возврат"),
                  },
                  {
                    key: "qty",
                    label: "Штук",
                    numeric: true,
                    render: (r) => -r.qty,
                  },
                  {
                    key: "revenue_cents",
                    label: "Продажи",
                    numeric: true,
                    render: (r) =>
                      r.revenue_cents == null
                        ? "Нет оценки"
                        : money(r.revenue_cents),
                  },
                  {
                    key: "cost_cents",
                    label: "Себестоимость",
                    numeric: true,
                    render: (r) =>
                      r.cost_cents == null
                        ? "Нет оценки"
                        : money(-r.qty * r.cost_cents),
                  },
                  {
                    key: "profit",
                    label: "Валовая прибыль",
                    numeric: true,
                    render: (r) =>
                      r.cost_cents == null || r.revenue_cents == null
                        ? "Нет оценки"
                        : money(r.revenue_cents + r.qty * r.cost_cents),
                  },
                ]}
              />
            )}
            <div className="total-line">
              <span>Итог показателя</span>
              <strong>{metric(drill)}</strong>
            </div>
            <p className="muted">
              Для полного состава и истории откройте соответствующий заказ в
              продажах.
            </p>
            <Button
              onClick={() => {
                setDrill(null);
                c.openPage("orders");
              }}
            >
              Перейти к заказам
            </Button>
          </div>
        </Drawer>
      )}
    </>
  );
}
