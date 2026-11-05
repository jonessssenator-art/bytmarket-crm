import React, { useEffect, useState } from "react";
import {
  Package,
  Wallet,
  AlertTriangle,
  ArrowRight,
  ShoppingCart,
} from "lucide-react";
import { useCRM } from "./App.jsx";
import { api, money, labelStatus } from "./api.js";
import { Button, Empty, Panel } from "./ui.jsx";
import { HeaderSlot } from "./print360/crm/HeaderSlot.jsx";
import { Segmented } from "./print360/ui/index.jsx";

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
  const all = c.data.overview;
  const alerts = (c.data.alerts || []).filter(
    (a) => a.entity_id === c.entity && a.status === "open",
  );
  const signals = c.data.attention || [];
  const inWork = (c.data.orders || []).filter((o) =>
    ["confirmed", "partially_shipped"].includes(o.status),
  );
  const caption =
    period === "today"
      ? "Сегодня"
      : period === "week"
        ? "За 7 дней"
        : "С начала месяца";
  const value = (amount) => (amount == null ? "Нет оценки" : money(amount));
  const metrics = [
    {
      label: "Продажи",
      value: report?.sales_cents,
      page: "reports",
      note: "Отгрузки с учётом возвратов",
    },
    {
      label: "Валовая прибыль",
      value: report?.gross_profit_cents,
      page: "reports",
      note:
        report?.cost_status === "incomplete"
          ? "Неполная себестоимость"
          : "До расходов магазина",
    },
    {
      label: "Получено денег",
      value: report?.receipts_cents,
      page: "finance",
      note: "Фактические поступления",
    },
    {
      label: "Долги покупателей",
      value: all?.debt_cents,
      page: "finance",
      note: all?.overdue_cents
        ? "Просрочено " + money(all.overdue_cents)
        : "На текущий момент",
    },
  ];
  return (
    <section className="bm-simple-home">
      <HeaderSlot>
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: "today", label: "Сегодня" },
            { value: "week", label: "Неделя" },
            { value: "month", label: "Месяц" },
          ]}
          ariaLabel="Период"
        />
      </HeaderSlot>
      <div className="bm-simple-heading">
        <h2>{caption}: деньги и продажи</h2>
        <button className="link" onClick={() => c.openPage("reports")}>
          Открыть аналитику
        </button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <dl className="bm-simple-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>
              <button onClick={() => c.openPage(metric.page)}>
                {!report && !error && metric.label !== "Долги покупателей"
                  ? "Загрузка…"
                  : metric.label === "Долги покупателей" &&
                      !all &&
                      !c.errors.overview
                    ? "Загрузка…"
                    : value(metric.value)}
              </button>
            </dd>
            <small>{metric.note}</small>
          </div>
        ))}
      </dl>
      <div className="bm-daily-actions" aria-label="Основные действия">
        <Button primary onClick={() => c.openPage("orders", { new: true })}>
          <ShoppingCart size={18} />
          Продать товар
        </Button>
        <Button onClick={() => c.openPage("stock", { action: "receive" })}>
          <Package size={18} />
          Принять товар
        </Button>
        <Button onClick={() => c.openPage("finance")}>
          <Wallet size={18} />
          Деньги и долги
        </Button>
      </div>
      <Panel
        title="Что требует решения"
        action={
          <button
            className="link"
            onClick={() => c.openPage("reports", { tab: "attention" })}
          >
            Все проблемы
          </button>
        }
      >
        <div className="bm-action-list">
          {alerts.length > 0 && (
            <button
              className="bm-action-row"
              onClick={() => c.openPage("stock")}
            >
              <Package size={20} />
              <span>
                <strong>Пополнить остатки: {alerts.length} позиций</strong>
                <small>
                  {alerts
                    .slice(0, 2)
                    .map((a) => `${a.name}: ${a.available} шт.`)
                    .join("; ")}
                  . Порог указан в карточке товара.
                </small>
              </span>
              <ArrowRight size={18} />
            </button>
          )}
          {all?.overdue_cents > 0 && (
            <button
              className="bm-action-row"
              onClick={() => c.openPage("finance")}
            >
              <Wallet size={20} />
              <span>
                <strong>Просроченные оплаты: {money(all.overdue_cents)}</strong>
                <small>
                  Проверить задолженность и связаться с покупателями.
                </small>
              </span>
              <ArrowRight size={18} />
            </button>
          )}
          {signals.slice(0, 3).map((signal) => (
            <button
              key={signal.id}
              className="bm-action-row"
              onClick={() =>
                c.openPage(
                  signal.page || "reports",
                  signal.page === "home"
                    ? { tab: "tasks" }
                    : signal.page
                      ? {}
                      : { tab: "attention" },
                )
              }
            >
              <AlertTriangle size={20} />
              <span>
                <strong>{signal.title}</strong>
                <small>{signal.detail}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
          {!alerts.length && !signals.length && !all?.overdue_cents && (
            <Empty
              title={
                c.loading ? "Проверяем данные…" : "Срочных проблем не найдено"
              }
            >
              Подробности доступны в аналитике.
            </Empty>
          )}
        </div>
      </Panel>
      <Panel
        title={`Заказы в работе: ${inWork.length}`}
        action={
          <button className="link" onClick={() => c.openPage("orders")}>
            Все продажи
          </button>
        }
      >
        {inWork.length ? (
          <div className="bm-action-list">
            {inWork.slice(0, 5).map((order) => (
              <button
                key={order.id}
                className="bm-action-row"
                onClick={() => c.openPage("orders", { id: order.id })}
              >
                <span>
                  <strong>
                    № {order.number} ·{" "}
                    {order.client_name || "Розничный покупатель"}
                  </strong>
                  <small>{labelStatus(order.status)}</small>
                </span>
                <b>{money(order.total_cents)}</b>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        ) : (
          <Empty title="Нет заказов, ожидающих отгрузки" />
        )}
      </Panel>
    </section>
  );
}
