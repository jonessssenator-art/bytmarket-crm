import React, { useEffect, useState } from "react";
import { Plus, Download, Upload, ArrowRightLeft } from "lucide-react";
import { useCRM } from "./App.jsx";
import { api, cents, money, parseCsv, csvDownload, date } from "./api.js";
import {
  Button,
  Panel,
  PageHeading,
  Table,
  SearchBox,
  RecordForm,
  Drawer,
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
const number = (v, field) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Проверьте поле «" + field + "».");
  return n;
};
export function Products() {
  const c = useCRM(),
    [q, setQ] = useState(c.navigationTarget?.q || ""),
    [edit, setEdit] = useState(null),
    [importing, setImporting] = useState(false);
  useEffect(() => {
    setQ(c.navigationTarget?.q || "");
  }, [c.navigationTarget?.key]);
  const rows = (c.data.products || []).filter((x) =>
    (x.name + " " + x.sku + " " + x.barcode)
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  const manage = c.meta.permissions?.can_manage || c.has();
  const fields = [
    f("sku", "Артикул", "text", true),
    f("name", "Название", "text", true),
    f("barcode", "Штрихкод"),
    f("brand", "Бренд"),
    f("category", "Категория"),
    f("group", "Товарная группа"),
    f("volume", "Объём"),
    f("weight", "Вес"),
    f("scent", "Аромат"),
    f("inner_pack_size", "Штук в упаковке", "number", true, {
      min: 1,
      step: 1,
    }),
    f("pack_size", "Штук в коробке", "number", true, { min: 1, step: 1 }),
    f("retail", "Розничная цена, ₽", "text", true),
    f("wholesale", "Оптовая цена, ₽", "text", true),
    f("min_stock", "Порог остатка, шт.", "number", true, { min: 0, step: 1 }),
    f("expiry_required", "Учитывать срок годности", "checkbox"),
    f("marked", "Маркируемый товар", "checkbox"),
    f("active", "Товар активен", "checkbox"),
  ];
  return (
    <>
      <PageHeading>
        <div>
          <h1>Товары</h1>
          <p>Каталог, цены и доступность в выбранном складе</p>
        </div>
        {manage && (
          <div className="actions">
            <Button onClick={() => setImporting(true)}>
              <Upload size={16} />
              Импорт CSV
            </Button>
            <Button
              primary
              onClick={() =>
                setEdit({ pack_size: 1, min_stock: 50, active: true })
              }
            >
              <Plus size={16} />
              Товар
            </Button>
          </div>
        )}
      </PageHeading>
      <Panel>
        <div className="toolbar">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Название, артикул или штрихкод"
          />
          <span className="muted">{rows.length} товаров</span>
        </div>
        <Table
          viewKey="products"
          rows={rows}
          empty="Добавьте первый товар или загрузите каталог из CSV."
          columns={[
            {
              key: "name",
              label: "Товар",
              render: (r) => (
                <>
                  <strong>{r.name}</strong>
                  <small>
                    {r.sku}
                    {r.brand ? " · " + r.brand : ""}
                  </small>
                </>
              ),
            },
            {
              key: "pack_size",
              label: "Упаковка",
              render: (r) => r.pack_size + " шт.",
            },
            {
              key: "retail_cents",
              label: "Розница",
              numeric: true,
              render: (r) => money(r.retail_cents),
            },
            {
              key: "wholesale_cents",
              label: "Опт",
              numeric: true,
              render: (r) => money(r.wholesale_cents),
            },
            {
              key: "available",
              label: "Доступно",
              numeric: true,
              render: (r) => r.available ?? "Нет данных",
            },
            {
              key: "action",
              label: "",
              render: (r) =>
                manage ? (
                  <Button
                    onClick={() =>
                      setEdit({
                        ...r,
                        retail: String(r.retail_cents / 100),
                        wholesale: String(r.wholesale_cents / 100),
                      })
                    }
                  >
                    Изменить
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>
      {edit && (
        <RecordForm
          title={edit.id ? "Изменить товар" : "Новый товар"}
          initial={{ inner_pack_size: 1, ...edit, ...edit.attributes }}
          fields={fields}
          onClose={() => setEdit(null)}
          submit={async (v) => {
            const body = {
              ...v,
              pack_size: number(v.pack_size, "Упаковка"),
              min_stock: number(v.min_stock, "Порог"),
              retail_cents: cents(v.retail),
              wholesale_cents: cents(v.wholesale),
              unit: "шт",
              attributes: {
                ...edit.attributes,
                inner_pack_size: number(v.inner_pack_size || 1, "Упаковка"),
                group: v.group || "",
                volume: v.volume || "",
                weight: v.weight || "",
                scent: v.scent || "",
              },
            };
            await c.mutate(
              "/products" + (edit.id ? "/" + edit.id : ""),
              body,
              edit.id ? "PATCH" : "POST",
            );
            c.setToast("Товар сохранён");
          }}
        />
      )}
      {importing && <ImportProducts onClose={() => setImporting(false)} />}
    </>
  );
}
function ImportProducts({ onClose }) {
  const c = useCRM(),
    [rows, setRows] = useState([]),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function read(file) {
    setError("");
    setPreview(null);
    try {
      const data = parseCsv(await file.text()).map((r) => ({
        ...r,
        pack_size: Number(r.pack_size || 1),
        min_stock: Number(r.min_stock === "" ? 50 : (r.min_stock ?? 50)),
        retail_cents: r.retail_cents
          ? Number(r.retail_cents)
          : cents(r.retail || "0"),
        wholesale_cents: r.wholesale_cents
          ? Number(r.wholesale_cents)
          : cents(r.wholesale || "0"),
        active: true,
      }));
      if (!data.length) throw new Error("В файле нет строк товаров.");
      setRows(data);
      setBusy(true);
      setPreview(
        await api("/products/import/preview", {
          method: "POST",
          body: { rows: data },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer title="Импорт товаров из CSV" onClose={onClose} wide>
      <div className="drawer-body">
        <p>
          Сначала проверим файл. Каталог изменится только после подтверждения
          импорта.
        </p>
        <Button
          onClick={() =>
            csvDownload("Шаблон товаров", [
              [
                "sku",
                "name",
                "barcode",
                "pack_size",
                "retail",
                "wholesale",
                "min_stock",
              ],
            ])
          }
        >
          <Download size={16} />
          Скачать шаблон
        </Button>
        <label className="file-input">
          Выбрать CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files[0] && read(e.target.files[0])}
          />
        </label>
        <p className="muted">
          Цены retail и wholesale - в рублях; разделитель точка или запятая.
          Количество - целые штуки.
        </p>
        {error && <div className="error-box">{error}</div>}
        {busy && <p>Проверяем строки…</p>}
        {preview && (
          <>
            {preview.errors?.length > 0 && (
              <div className="error-box">
                {preview.errors.map((e) => (
                  <p key={e.row}>
                    Строка {e.row}: {e.error}
                  </p>
                ))}
              </div>
            )}
            <p className="notice">
              Проверено строк: {rows.length}. Просмотрите цены перед загрузкой.
            </p>
            <Table
              rows={rows.slice(0, 50)}
              columns={[
                { key: "sku", label: "Артикул" },
                { key: "name", label: "Название" },
                {
                  key: "retail_cents",
                  label: "Розница",
                  render: (r) => money(r.retail_cents),
                },
                {
                  key: "wholesale_cents",
                  label: "Опт",
                  render: (r) => money(r.wholesale_cents),
                },
              ]}
            />
            <Button
              primary
              disabled={!preview.valid}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await c.mutate("/products/import", {
                    rows,
                    preview_hash: preview.preview_hash || preview.hash,
                  });
                  c.setToast("Каталог импортирован");
                  onClose();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Импортировать {rows.length} строк
            </Button>
          </>
        )}
      </div>
    </Drawer>
  );
}
export function Clients() {
  const c = useCRM(),
    [q, setQ] = useState(c.navigationTarget?.q || ""),
    [edit, setEdit] = useState(null);
  useEffect(() => {
    setQ(c.navigationTarget?.q || "");
  }, [c.navigationTarget?.key]);
  const manage = c.has("seller", "manager", "rep", "accountant");
  const fields = [
    f("name", "Название / имя", "text", true),
    f("kind", "Тип", "select", true, {
      options: [
        { value: "customer", label: "Покупатель" },
        ...(c.has("accountant")
          ? [{ value: "supplier", label: "Поставщик" }]
          : []),
      ],
    }),
    f("phone", "Телефон", "tel"),
    f("email", "Email", "email"),
    f("address", "Адрес", "text"),
    f("inn", "ИНН"),
    f("assigned_to", "Ответственный", "select", false, {
      options: c.meta.users || [],
    }),
    f("credit_limit", "Лимит задолженности, ₽"),
    f("term_days", "Отсрочка, дней", "number", false, { min: 0, step: 1 }),
    f("notes", "Комментарий", "textarea", false, { full: true }),
  ];
  return (
    <>
      <PageHeading>
        <div>
          <h1>Клиенты</h1>
          <p>Контакты, условия и ответственные</p>
        </div>
        {manage && (
          <Button
            primary
            onClick={() =>
              setEdit({
                kind: "customer",
                assigned_to: c.auth.id,
                credit_limit: "0",
                term_days: 0,
              })
            }
          >
            <Plus size={16} />
            Клиент
          </Button>
        )}
      </PageHeading>
      <Panel>
        <div className="toolbar">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Имя, телефон или ИНН"
          />
        </div>
        <Table
          rows={(c.data.clients || []).filter((x) =>
            (x.name + " " + x.phone + " " + x.inn)
              .toLowerCase()
              .includes(q.toLowerCase()),
          )}
          empty="Создайте клиента для именного заказа или оптовой продажи."
          columns={[
            {
              key: "name",
              label: "Клиент",
              render: (r) => (
                <>
                  <strong>{r.name}</strong>
                  <small>
                    {r.kind === "supplier" ? "Поставщик" : "Покупатель"}
                  </small>
                </>
              ),
            },
            {
              key: "phone",
              label: "Связь",
              render: (r) => (
                <>
                  {r.phone && <a href={"tel:" + r.phone}>{r.phone}</a>}
                  <small>{r.email}</small>
                </>
              ),
            },
            { key: "address", label: "Адрес" },
            {
              key: "assigned_to",
              label: "Ответственный",
              render: (r) =>
                c.meta.users.find((x) => x.id === r.assigned_to)?.name ||
                "Не назначен",
            },
            {
              key: "term_days",
              label: "Отсрочка",
              render: (r) => (r.term_days || 0) + " дн.",
            },
            {
              key: "actions",
              label: "",
              render: (r) =>
                manage ? (
                  <Button
                    onClick={() =>
                      setEdit({
                        ...r,
                        credit_limit: String((r.credit_limit_cents || 0) / 100),
                      })
                    }
                  >
                    Изменить
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>
      {edit && (
        <RecordForm
          title={edit.id ? "Карточка клиента" : "Новый клиент"}
          initial={edit}
          fields={fields.filter(
            (f) =>
              c.has("accountant") ||
              !["credit_limit", "term_days"].includes(f.key),
          )}
          onClose={() => setEdit(null)}
          submit={async (v) => {
            const body = { ...v, assigned_to: v.assigned_to || null };
            if (c.has("accountant")) {
              body.credit_limit_cents = cents(v.credit_limit || "0");
              body.term_days = Number(v.term_days || 0);
            } else {
              delete body.credit_limit_cents;
              delete body.term_days;
            }
            await c.mutate(
              "/clients" + (edit.id ? "/" + edit.id : ""),
              body,
              edit.id ? "PATCH" : "POST",
            );
            c.setToast("Клиент сохранён");
          }}
        />
      )}
    </>
  );
}
export function Stock() {
  const c = useCRM(),
    [q, setQ] = useState(c.navigationTarget?.q || ""),
    [operation, setOperation] = useState(null),
    [tab, setTab] = useState("balances");
  const ops = {
    receive: "Приход товара",
    adjust: "Корректировка остатка",
    transfer: "Перемещение",
    release: "Вывод из карантина",
  };
  const base = [
    f("product_id", "Товар", "select", true, {
      options: c.data.products || [],
    }),
    f("qty", "Количество, шт.", "number", true, {
      step: 1,
      min: operation === "adjust" ? undefined : 1,
    }),
  ];
  if (operation === "receive")
    base.push(
      ...(c.has("accountant")
        ? [
            f("cost", "Стоимость за штуку, ₽", "text", false, {
              hint: "Если стоимость неизвестна, оставьте пустой. Прибыль будет без оценки.",
            }),
          ]
        : []),
      f("quarantine", "Поступление в карантин", "checkbox"),
      f("batch_number", "Партия"),
      f("expires_at", "Годен до", "date"),
      f("supplier_id", "Поставщик", "select", false, {
        options: (c.data.clients || []).filter((x) => x.kind === "supplier"),
      }),
    );
  if (operation === "transfer")
    base.push(
      f("to_warehouse_id", "Склад назначения", "select", true, {
        options: c.meta.warehouses.filter((x) => x.id !== c.warehouse),
      }),
    );
  base.push(
    f("reason", "Основание / причина", "textarea", true, { full: true }),
  );
  return (
    <>
      <PageHeading>
        <div>
          <h1>Склад</h1>
          <p>Остатки принадлежат выбранной организации</p>
        </div>
        {(c.meta.permissions.can_stock || c.has("accountant")) && (
          <div className="actions">
            <Button primary onClick={() => setOperation("receive")}>
              <Plus size={16} />
              Приход
            </Button>
            <Button onClick={() => setOperation("transfer")}>
              <ArrowRightLeft size={16} />
              Переместить
            </Button>
          </div>
        )}
      </PageHeading>
      <div className="tabs">
        <button
          className={tab === "balances" ? "active" : ""}
          onClick={() => setTab("balances")}
        >
          Остатки
        </button>
        <button
          className={tab === "movements" ? "active" : ""}
          onClick={() => setTab("movements")}
        >
          Движения
        </button>
      </div>
      <Panel>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} />
          {c.has() && (
            <div className="actions">
              <Button onClick={() => setOperation("adjust")}>
                Корректировка
              </Button>
              <Button onClick={() => setOperation("release")}>
                Из карантина
              </Button>
            </div>
          )}
        </div>
        {tab === "balances" ? (
          <Table
            rows={(c.data.stock || []).map((r) => ({
              ...r,
              physical_qty: r.on_hand + r.quarantine,
            })).filter((r) =>
              (r.name + " " + r.sku).toLowerCase().includes(q.toLowerCase()),
            )}
            empty="Остатков ещё нет. Оформите фактический приход товара."
            columns={[
              {
                key: "name",
                label: "Товар",
                render: (r) => (
                  <>
                    <strong>{r.name}</strong>
                    <small>{r.sku}</small>
                  </>
                ),
              },
              { key: "physical_qty", label: "Фактически", numeric: true },
              { key: "reserved", label: "В резерве", numeric: true },
              { key: "available", label: "Доступно", numeric: true },
              { key: "quarantine", label: "Карантин", numeric: true },
            ]}
          />
        ) : (
          <Table
            rows={c.data.movements || []}
            columns={[
              {
                key: "created_at",
                label: "Дата",
                render: (r) => date(r.created_at),
              },
              {
                key: "name",
                label: "Товар",
                render: (r) =>
                  r.name ||
                  c.data.products?.find((p) => p.id === r.product_id)?.name ||
                  r.product_id,
              },
              { key: "kind", label: "Операция" },
              { key: "qty", label: "Штук", numeric: true },
              { key: "reason", label: "Основание" },
            ]}
          />
        )}
      </Panel>
      {operation && (
        <RecordForm
          title={ops[operation]}
          fields={base}
          initial={{ qty: 1 }}
          hint="Операция изменит реальный учёт. Проверьте организацию и склад в верхней панели. Перемещение не меняет владельца товара."
          onClose={() => setOperation(null)}
          submit={async (v) => {
            const body = {
              ...v,
              entity_id: c.entity,
              warehouse_id: c.warehouse,
              qty: Number(v.qty),
            };
            if (operation === "receive")
              body.cost_cents =
                v.cost == null || String(v.cost).trim() === ""
                  ? null
                  : cents(v.cost);
            await c.mutate("/stock/" + operation, body);
            c.setToast("Складская операция сохранена");
          }}
        />
      )}
    </>
  );
}
export function Administration() {
  const c = useCRM(),
    [form, setForm] = useState(null);
  const roles = [
    ["owner", "Владелец"],
    ["seller", "Продавец"],
    ["manager", "Менеджер"],
    ["rep", "Торгпред"],
    ["accountant", "Бухгалтер"],
    ["warehouse", "Склад"],
    ["dispatcher", "Диспетчер"],
    ["courier", "Курьер"],
  ];
  const configs = {
    warehouse: {
      title: "Новый склад",
      fields: [f("name", "Название", "text", true)],
      url: "/warehouses",
    },
    entity: {
      title: "Организация",
      fields: [
        f("name", "Наименование", "text", true),
        f("kind", "Тип", "select", true, {
          options: [
            { value: "ooo", label: "ООО" },
            { value: "ip", label: "ИП" },
          ],
        }),
        f("inn", "ИНН"),
        f("kpp", "КПП"),
        f("address", "Юридический адрес"),
        f("bank", "Банк"),
        f("account", "Расчётный счёт"),
        f("bik", "БИК"),
      ],
      url: "/entities",
    },
    settings: {
      title: "Правила продаж и запаса",
      fields: [
        f("wholesale_min_qty", "Минимум опта, шт.", "number", false, {
          min: 1,
          step: 1,
          hint: "Пусто - минимум ещё не установлен",
        }),
        f("low_stock_threshold", "Порог остатка по умолчанию", "number", true, {
          min: 0,
          step: 1,
        }),
        f("allow_credit", "Разрешить отсрочку", "checkbox"),
        f(
          "legal_transfer_ready",
          "Оформление передачи ООО → ИП согласовано",
          "checkbox",
        ),
        f("retail_entity_id", "Организация розницы", "select", true, {
          options: c.meta.entities,
        }),
        f("wholesale_entity_id", "Организация опта", "select", true, {
          options: c.meta.entities,
        }),
      ],
      url: "/settings",
    },
  };
  return (
    <>
      <PageHeading>
        <div>
          <h1>Настройки</h1>
          <p>Доступ сотрудников, организации и правила учёта</p>
        </div>
      </PageHeading>
      <div className="settings-grid">
        <Panel
          title="Сотрудники"
          action={
            <Button
              primary
              onClick={() =>
                setForm({
                  type: "user",
                  value: {
                    roles: ["seller"],
                    entity_ids: [c.entity],
                    warehouse_ids: [c.warehouse],
                  },
                })
              }
            >
              Добавить
            </Button>
          }
        >
          <Table
            rows={c.data.users || c.meta.users || []}
            columns={[
              { key: "name", label: "Имя" },
              {
                key: "roles",
                label: "Полномочия",
                render: (r) =>
                  (r.roles || [])
                    .map((v) => roles.find((x) => x[0] === v)?.[1] || v)
                    .join(", "),
              },
              {
                key: "action",
                label: "",
                render: (r) => (
                  <Button onClick={() => setForm({ type: "user", value: r })}>
                    Доступ
                  </Button>
                ),
              },
            ]}
          />
        </Panel>
        <Panel
          title="Организации"
          action={
            <Button onClick={() => setForm({ type: "entity", value: {} })}>
              Добавить
            </Button>
          }
        >
          {c.meta.entities.map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <strong>{e.name}</strong>
                <small>{e.kind}</small>
              </div>
              <Button
                onClick={() =>
                  setForm({
                    type: "entity",
                    value: {
                      ...e,
                      ...(typeof e.details === "object" ? e.details : {}),
                    },
                  })
                }
              >
                Реквизиты
              </Button>
            </div>
          ))}
        </Panel>
        <Panel
          title="Склады"
          action={
            <Button onClick={() => setForm({ type: "warehouse", value: {} })}>
              Добавить
            </Button>
          }
        >
          {c.meta.warehouses.map((w) => (
            <div className="list-row" key={w.id}>
              {w.name}
            </div>
          ))}
        </Panel>
        <Panel title="Сохранение и резервная копия">
          <div className="panel-body">
            <p>Данные хранятся на сервере в SQLite.</p>
            {c.data.maintenance?.backup?.ok === false ? (
              <p className="error-box">
                Ошибка резервной копии:{" "}
                {c.data.maintenance.backup.error ||
                  "Проверьте доступность папки"}
              </p>
            ) : (
              <p>
                Последняя копия:{" "}
                {c.data.maintenance?.backup?.created_at
                  ? date(c.data.maintenance.backup.created_at)
                  : "ещё не подтверждена"}
              </p>
            )}
            <p className="muted">
              По умолчанию копии лежат на этом же компьютере. Для защиты от его
              поломки нужна отдельная внешняя копия.
            </p>
          </div>
        </Panel>
        <Panel title="Правила">
          <div className="panel-body">
            <p>
              Оптовый минимум:{" "}
              {c.meta.settings.wholesale_min_qty ?? "не установлен"}
            </p>
            <p>
              Порог остатка: {c.meta.settings.low_stock_threshold ?? 50} шт.
            </p>
            <div className="actions wrap">
              <Button
                onClick={() =>
                  setForm({ type: "settings", value: c.meta.settings })
                }
              >
                Настроить
              </Button>
              <Button onClick={() => c.openPage("visits")}>
                Визиты и акции
              </Button>
            </div>
            <p className="muted">
              Касса и 1С не подключены. Подтверждённая запись оплаты в CRM не
              заменяет кассовый чек.
            </p>
          </div>
        </Panel>
      </div>
      {form?.type === "user" ? (
        <UserForm
          initial={form.value}
          roles={roles}
          onClose={() => setForm(null)}
        />
      ) : (
        form && (
          <RecordForm
            title={configs[form.type].title}
            fields={configs[form.type].fields}
            initial={form.value}
            onClose={() => setForm(null)}
            submit={async (v) => {
              let body = v;
              if (form.type === "settings")
                body = {
                  ...v,
                  wholesale_min_qty:
                    v.wholesale_min_qty === ""
                      ? null
                      : Number(v.wholesale_min_qty),
                  low_stock_threshold: Number(v.low_stock_threshold),
                };
              if (form.type === "entity")
                body = {
                  name: v.name,
                  kind: v.kind,
                  details: {
                    inn: v.inn,
                    kpp: v.kpp,
                    address: v.address,
                    bank: v.bank,
                    account: v.account,
                    bik: v.bik,
                  },
                };
              await c.mutate(
                configs[form.type].url +
                  (form.type === "entity" && v.id ? "/" + v.id : ""),
                body,
                form.type === "settings" || (form.type === "entity" && v.id)
                  ? "PATCH"
                  : "POST",
              );
              c.setToast("Настройки сохранены");
            }}
          />
        )
      )}
    </>
  );
}
function UserForm({ initial, roles, onClose }) {
  const c = useCRM(),
    [v, setV] = useState({
      ...initial,
      entity_ids: initial.entity_ids || [],
      warehouse_ids: initial.warehouse_ids || [],
      roles: initial.roles || [],
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const toggle = (key, id) =>
    setV({
      ...v,
      [key]: v[key].includes(id)
        ? v[key].filter((x) => x !== id)
        : [...v[key], id],
    });
  return (
    <Drawer
      title={initial.id ? "Доступ сотрудника" : "Новый сотрудник"}
      onClose={onClose}
    >
      <form
        className="drawer-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (!v.roles.length) throw new Error("Выберите хотя бы одну роль");
            await c.mutate(
              "/users" + (v.id ? "/" + v.id : ""),
              v,
              v.id ? "PATCH" : "POST",
            );
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Имя
          <input
            required
            value={v.name || ""}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </label>
        <label className="field">
          Email
          <input
            type="email"
            required
            value={v.email || ""}
            onChange={(e) => setV({ ...v, email: e.target.value })}
          />
        </label>
        <label className="field">
          {v.id ? "Новый пароль (необязательно)" : "Пароль"}
          <input
            type="password"
            required={!v.id}
            minLength={12}
            autoComplete="new-password"
            value={v.password || ""}
            onChange={(e) => {
              const next = { ...v };
              if (e.target.value) next.password = e.target.value;
              else delete next.password;
              setV(next);
            }}
          />
        </label>
        {[
          ["roles", "Роли", roles.map(([id, name]) => ({ id, name }))],
          ["entity_ids", "Организации", c.meta.entities],
          ["warehouse_ids", "Склады", c.meta.warehouses],
        ].map(([key, title, opts]) => (
          <fieldset key={key}>
            <legend>{title}</legend>
            {opts.map((o) => (
              <label className="check" key={o.id}>
                <input
                  type="checkbox"
                  checked={v[key].includes(o.id)}
                  onChange={() => toggle(key, o.id)}
                />
                {o.name}
              </label>
            ))}
          </fieldset>
        ))}
        {v.id && (
          <label className="check">
            <input
              type="checkbox"
              checked={v.active !== false && v.active !== 0}
              onChange={(e) => setV({ ...v, active: e.target.checked })}
            />
            Учётная запись активна
          </label>
        )}
        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          <Button onClick={onClose} type="button">
            Отмена
          </Button>
          <Button type="submit" primary busy={busy}>
            Сохранить доступ
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
