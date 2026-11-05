import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Package,
  Truck,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Plus,
  Search,
  ShoppingCart,
  Users,
  CalendarDays,
} from "lucide-react";
import { useCRM } from "./App.jsx";
import { api, money, date, labelStatus } from "./api.js";
import { Button, Empty } from "./ui.jsx";
import { HeaderSlot } from "./print360/crm/HeaderSlot.jsx";
import { Segmented } from "./print360/ui/index.jsx";
import GlowTile, { GlowStages, GlowSpark } from "./print360/ui/fx/GlowTile.jsx";
import GlassPanel from "./print360/ui/fx/GlassPanel.jsx";
import DarkPlate from "./print360/ui/fx/DarkPlate.jsx";

export default function Dashboard() {
  const c = useCRM(),
    [period, setPeriod] = useState("today"),
    [report, setReport] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!c.entity) return;
    let live = true;
    setReport(null);
    const now = new Date();
    const localDay = new Date(now.getTime() + 4 * 3600000)
      .toISOString()
      .slice(0, 10);
    const end = new Date(Date.parse(localDay + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    const start =
      period === "month"
        ? localDay.slice(0, 7) + "-01"
        : period === "week"
          ? new Date(Date.parse(localDay + "T00:00:00Z") - 6 * 86400000)
              .toISOString()
              .slice(0, 10)
          : localDay;
    api(
      "/reports/overview?" +
        new URLSearchParams({ entity_id: c.entity, from: start, to: end }),
    )
      .then((r) => {
        if (live) {
          setReport(r);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [c.entity, c.data.overview, period]);
  const all = c.data.overview,
    orders = c.data.orders || [],
    stock = c.data.stock || [],
    products = c.data.products || [],
    payments = report?.receipt_documents || [],
    alerts = (c.data.alerts || []).filter(
      (a) => a.entity_id === c.entity && a.status === "open",
    );
  const entity = c.meta.entities.find((e) => e.id === c.entity),
    deliveries = (c.data.deliveries || []).filter(
      (d) => d.entity_id === c.entity,
    );
  const counts = [
    {
      label: "В резерве",
      value: orders.filter((o) => o.status === "confirmed").length,
    },
    {
      label: "Частично",
      value: orders.filter((o) => o.status === "partially_shipped").length,
    },
    {
      label: "Отгружено",
      value: orders.filter((o) => o.status === "shipped").length,
    },
  ];
  const inWork = counts[0].value + counts[1].value;
  const categoryRows = Object.entries(
    stock.reduce((acc, s) => {
      const p = products.find((p) => p.id === s.product_id),
        key = p?.category || "Без категории";
      acc[key] = (acc[key] || 0) + s.available;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const categoryTotal = categoryRows.reduce((n, [, v]) => n + v, 0);
  const checks = [
    {
      title: "Заполнить реквизиты",
      note: "Организация, ИНН и расчётный счёт",
      done: !!entity?.details?.inn,
      page: "settings",
      icon: Wallet,
    },
    {
      title: "Добавить товары",
      note: "Каталог, упаковки и цены",
      done: products.length > 0,
      page: "products",
      icon: Package,
    },
    {
      title: "Внести начальные остатки",
      note: "По результатам пересчёта склада",
      done: stock.length > 0,
      page: "stock",
      icon: CheckCircle2,
    },
    {
      title: "Установить условия опта",
      note: "Минимальный заказ в штуках",
      done: c.meta.settings.wholesale_min_qty != null,
      page: "settings",
      icon: Users,
    },
  ];
  const signals = c.data.attention || [];
  const needsSetup = checks.some((x) => !x.done),
    caption =
      period === "today"
        ? "сегодня"
        : period === "week"
          ? "за 7 дней"
          : "за месяц";
  const showValue = (v) => (v == null ? "Нет оценки" : v / 100);
  return (
    <>
      <HeaderSlot>
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: "today", label: "Сегодня" },
            { value: "week", label: "Неделя" },
            { value: "month", label: "Месяц" },
          ]}
          tone="white"
          ariaLabel="Период"
        />
        <Button primary onClick={() => c.openPage("orders", { new: true })}>
          <Plus size={16} />
          Новая продажа
        </Button>
      </HeaderSlot>
      <div className="bm-greeting">
        <div>
          <h2>БытМаркет сегодня</h2>
          <p>
            {new Intl.DateTimeFormat("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: "Europe/Astrakhan",
            }).format(new Date())}
            <span>Розница и опт · Астрахань</span>
          </p>
        </div>
        <span className="bm-live">
          <i />
          Данные вашей организации
        </span>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="bm-kpis">
        <GlowTile
          title={"Получено " + caption}
          value={showValue(report?.receipts_cents)}
          format="money"
          tone="lime"
          icon="income"
          loading={!report && !error}
          chips={[{ label: payments.length + " оплат" }]}
          onClick={() => c.openPage("finance")}
        />
        <GlowTile
          title="Долги покупателей"
          value={showValue(all?.debt_cents)}
          format="money"
          tone="ember"
          icon="receipt"
          loading={!all}
          chips={[
            {
              label:
                all?.overdue_cents > 0
                  ? "Просрочено " + money(all.overdue_cents)
                  : "Просрочки нет",
            },
          ]}
          onClick={() => c.openPage("reports")}
        />
        <GlowTile
          title="Заказы в работе"
          value={inWork}
          unit={["заказ", "заказа", "заказов"]}
          tone="sky"
          icon="boxes"
          aside={<GlowStages items={counts} />}
          chips={[
            {
              label:
                deliveries.filter(
                  (d) => !["delivered", "failed"].includes(d.status),
                ).length + " доставок",
            },
          ]}
          onClick={() => c.openPage("orders")}
        />
        <GlowTile
          title={"Валовая прибыль " + caption}
          value={showValue(report?.gross_profit_cents)}
          format="money"
          tone="violet"
          icon="trend"
          loading={!report && !error}
          chips={[
            {
              label:
                report?.cost_status === "incomplete"
                  ? "Есть неизвестная себестоимость"
                  : "Отгрузки минус себестоимость",
            },
          ]}
          onClick={() => c.openPage("reports")}
        />
      </div>
      <div className="bm-dashboard-grid">
        <GlassPanel className="bm-attention" pad={20}>
          <div className="bm-card-head">
            <h2>
              <span className="bm-icon ember">
                <AlertTriangle size={17} />
              </span>
              Требует внимания
            </h2>
            <span
              className={
                "ui-chip " +
                (alerts.length ? "ui-chip--bad" : "ui-chip--neutral")
              }
            >
              {alerts.length
                ? alerts.length + " низких остатков"
                : "Нет дефицита"}
            </span>
          </div>
          <div className="bm-action-list">
            {alerts.slice(0, 5).map((a) => (
              <button
                className="bm-action-row"
                key={a.id}
                onClick={() => c.openPage("stock")}
              >
                <span className="bm-icon ember">
                  <Package size={18} />
                </span>
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    Доступно {a.available} шт. · порог {a.threshold} шт.
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
            {signals.slice(0, 3).map((a) => (
              <button
                className="bm-action-row"
                key={a.id}
                onClick={() => c.openPage(a.page)}
              >
                <span className="bm-icon ember">
                  <AlertTriangle size={18} />
                </span>
                <span>
                  <strong>{a.title}</strong>
                  <small>{a.detail}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
            {needsSetup &&
              checks
                .filter((x) => !x.done)
                .map((item, i) => (
                  <button
                    className="bm-action-row"
                    key={item.title}
                    onClick={() => c.openPage(item.page)}
                  >
                    <span
                      className={
                        "bm-icon " + ["sky", "lime", "violet", "gold"][i % 4]
                      }
                    >
                      <item.icon size={18} />
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.note}</small>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
            {!alerts.length && !signals.length && !needsSetup && (
              <Empty title="Склад в порядке">
                Нет товаров с остатком ниже установленного порога.
              </Empty>
            )}
          </div>
          <div className="bm-card-footer">
            <span>Напоминания остаются внутри CRM</span>
            <button className="link" onClick={() => c.openPage("stock")}>
              На склад <ArrowRight size={14} />
            </button>
          </div>
        </GlassPanel>
        <GlassPanel pad={20} className="bm-recent-payments">
          <div className="bm-card-head">
            <h2>Оплаты {caption}</h2>
            <span className="bm-green">
              {report ? money(report.receipts_cents) : "Загрузка"}
            </span>
          </div>
          {payments.length ? (
            <div className="bm-payment-list">
              {payments.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  className="bm-payment-row"
                  onClick={() => c.openPage("finance")}
                >
                  <time>
                    {new Date(p.created_at).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Astrakhan",
                    })}
                  </time>
                  <span>
                    <strong>
                      {c.data.clients?.find((x) => x.id === p.client_id)
                        ?.name || "Розничный покупатель"}
                    </strong>
                    <small>
                      {p.reference || p.note || "Подтверждённое поступление"}
                    </small>
                  </span>
                  <b>+{money(p.amount_cents)}</b>
                </button>
              ))}
            </div>
          ) : (
            <div className="bm-quiet-empty">
              <span className="bm-icon lime">
                <ArrowDownLeft size={23} />
              </span>
              <h3>Поступлений пока нет</h3>
              <p>
                Здесь будут реальные оплаты покупателей за выбранный период.
              </p>
            </div>
          )}
          <div className="bm-card-footer">
            <span>Только полученные деньги</span>
            <button className="link" onClick={() => c.openPage("finance")}>
              Все оплаты <ArrowRight size={14} />
            </button>
          </div>
        </GlassPanel>
        <DarkPlate pad={20} className="bm-money-plate">
          <div className="bm-card-head">
            <h2>Деньги и товар</h2>
            <span>{entity?.name}</span>
          </div>
          <div className="bm-plate-amount">
            <small>Стоимость запасов</small>
            <strong>
              {all?.inventory_cents == null
                ? "Нет оценки"
                : money(all.inventory_cents)}
            </strong>
            <span>{products.length} товаров в каталоге</span>
          </div>
          <p className="bm-supplier-summary">
            Поставщикам:{" "}
            {all
              ? money(Math.max(0, all.supplier_balance_cents || 0))
              : "Загрузка"}
          </p>
          <div className="bm-plate-pairs">
            <div>
              <small>У сотрудников</small>
              <b>{money(all?.cash_custody_cents)}</b>
            </div>
            <div>
              <small>Расходы {caption}</small>
              <b>{money(report?.expenses_cents)}</b>
            </div>
          </div>
          <button
            className="bm-plate-link"
            onClick={() => c.openPage("finance")}
          >
            Открыть взаиморасчёты <ArrowRight size={15} />
          </button>
        </DarkPlate>
        <GlassPanel pad={20} className="bm-stock-card">
          <div className="bm-card-head">
            <h2>Доступно на складе</h2>
            <span>{categoryTotal} шт.</span>
          </div>
          {categoryRows.length ? (
            <div className="bm-category-list">
              {categoryRows.slice(0, 6).map(([name, n], i) => (
                <button onClick={() => c.openPage("stock")} key={name}>
                  <span
                    className={
                      "bm-icon " +
                      ["sky", "lime", "violet", "ember", "gold"][i % 5]
                    }
                  >
                    <Package size={17} />
                  </span>
                  <span>
                    <strong>
                      {name}
                      <b>{n} шт.</b>
                    </strong>
                    <i>
                      <span
                        style={{
                          width:
                            (categoryTotal ? (100 * n) / categoryTotal : 0) +
                            "%",
                          background: [
                            "#358ad8",
                            "#72a51a",
                            "#b445ce",
                            "#f36538",
                            "#c59638",
                          ][i % 5],
                        }}
                      />
                    </i>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="bm-quiet-empty">
              <span className="bm-icon sky">
                <Package size={23} />
              </span>
              <h3>Приходов ещё нет</h3>
              <p>
                Внесите остатки, чтобы видеть наличие и потребность в закупке.
              </p>
              <Button onClick={() => c.openPage("stock")}>
                Оформить приход
              </Button>
            </div>
          )}
        </GlassPanel>
        <GlassPanel pad={20} className="bm-order-card">
          <div className="bm-card-head">
            <h2>Последние заказы</h2>
            <button
              className="bm-round-action"
              aria-label="Создать продажу"
              onClick={() => c.openPage("orders", { new: true })}
            >
              <Plus size={18} />
            </button>
          </div>
          {orders.length ? (
            <div className="bm-mini-orders">
              {orders.slice(0, 4).map((o) => (
                <button
                  key={o.id}
                  onClick={() => c.openPage("orders", { id: o.id })}
                >
                  <span className="bm-icon sky">
                    <ShoppingCart size={16} />
                  </span>
                  <span>
                    <strong>№ {o.number}</strong>
                    <small>{o.client_name || "Розничная продажа"}</small>
                  </span>
                  <span>
                    <b>{money(o.total_cents)}</b>
                    <small>{labelStatus(o.status)}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="bm-quiet-empty">
              <span className="bm-icon violet">
                <ShoppingCart size={23} />
              </span>
              <h3>Первая продажа впереди</h3>
              <p>
                Розница без карточки покупателя. Для опта - клиент и его
                условия.
              </p>
              <Button onClick={() => c.openPage("orders", { new: true })}>
                Создать продажу
              </Button>
            </div>
          )}
        </GlassPanel>
      </div>
    </>
  );
}
