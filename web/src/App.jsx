import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Warehouse,
  Truck,
  Wallet,
  BarChart3,
  Settings,
  ShoppingBag,
  LogOut,
  RefreshCw,
  Menu,
  CalendarDays,
  X,
} from "lucide-react";
import { api, setCsrf } from "./api.js";
import { Button, Field, Empty } from "./ui.jsx";
import { Products, Clients, Stock, Administration } from "./Records.jsx";
import { Orders } from "./Orders.jsx";
import {
  Finance,
  Deliveries,
  Visits,
  Purchases,
  Overview,
} from "./Operations.jsx";
import AppNav from "./print360/shell/AppNav.jsx";
import NavMark from "./print360/shell/NavMark.jsx";
import { HeadSlotTarget } from "./print360/crm/HeaderSlot.jsx";
import Dashboard from "./Dashboard.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import TradingWorkspace from "./TradingWorkspace.jsx";
export const CRMContext = createContext(null);
export const useCRM = () => useContext(CRMContext);
const roleNames = {
  owner: "Владелец",
  seller: "Продавец",
  manager: "Менеджер",
  rep: "Торговый представитель",
  accountant: "Бухгалтер",
  warehouse: "Склад",
  dispatcher: "Диспетчер",
  courier: "Курьер",
};
const nav = [
  ["home", "Моё рабочее место", LayoutDashboard],
  ["orders", "Продажи", ShoppingCart],
  ["clients", "Клиенты", Users],
  ["products", "Товары", Package],
  ["stock", "Склад", Warehouse],
  ["purchases", "Закупки", ShoppingBag],
  ["finance", "Деньги", Wallet],
  ["deliveries", "Доставка", Truck],
  ["reports", "Аналитика", BarChart3],
  ["settings", "Настройки", Settings],
];
export default function App() {
  const [auth, setAuth] = useState(null),
    [setup, setSetup] = useState(false),
    [boot, setBoot] = useState(true),
    [bootError, setBootError] = useState("");
  const [meta, setMeta] = useState({
      entities: [],
      warehouses: [],
      users: [],
      settings: {},
      permissions: {},
    }),
    [data, setData] = useState({}),
    [errors, setErrors] = useState({}),
    [entity, setEntity] = useState(""),
    [warehouse, setWarehouse] = useState(""),
    [page, setPage] = useState("home"),
    [navigationTarget, setNavigationTarget] = useState(null),
    [loading, setLoading] = useState(false),
    [toast, setToast] = useState(""),
    [mobileMenu, setMobileMenu] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const generation = useRef(0);
  const reset = useCallback(() => {
    setAuth(null);
    setCsrf("");
    setData({});
    setMeta({
      entities: [],
      warehouses: [],
      users: [],
      settings: {},
      permissions: {},
    });
    setEntity("");
    setWarehouse("");
  }, []);
  async function bootstrap() {
    setBoot(true);
    setBootError("");
    try {
      const status = await api("/auth/status");
      setSetup(status.needs_setup);
      if (!status.needs_setup) {
        try {
          const result = await api("/auth/me");
          setAuth(result.user);
          setCsrf(result.csrf);
        } catch (e) {
          if (e.status !== 401) throw e;
        }
      }
    } catch (e) {
      setBootError(e.message);
    } finally {
      setBoot(false);
    }
  }
  useEffect(() => {
    bootstrap();
    const expired = () => {
      reset();
      setToast("Сессия завершена. Войдите снова.");
    };
    const net = () => setOnline(navigator.onLine);
    window.addEventListener("session-expired", expired);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, []);
  const roles = auth?.roles || [];
  const has = (...r) =>
    roles.includes("owner") || r.some((x) => roles.includes(x));
  const refresh = useCallback(async () => {
    if (!auth) return;
    const g = ++generation.current;
    setLoading(true);
    let m;
    try {
      m = await api("/meta");
      if (g !== generation.current) return;
      setMeta(m);
      if (!entity && m.entities?.length) {
        setEntity(
          m.entities.find(
            (e) =>
              e.id ===
              (auth.roles.includes("rep")
                ? m.settings?.wholesale_entity_id
                : m.settings?.retail_entity_id),
          )?.id || m.entities[0].id,
        );
        return;
      }
      if (!warehouse && m.warehouses?.length) {
        setWarehouse(m.warehouses[0].id);
        return;
      }
    } catch (e) {
      setErrors({ meta: e.message });
      setLoading(false);
      return;
    } finally {
      if (g === generation.current) setLoading(false);
    }
    const q = new URLSearchParams();
    if (entity) q.set("entity_id", entity);
    if (warehouse) q.set("warehouse_id", warehouse);
    const suffix = "?" + q;
    const endpoints = {
      ...(auth.roles.includes("owner")
        ? { users: "/users", maintenance: "/maintenance/status" }
        : {}),
      products: "/products" + suffix,
      clients: "/clients",
      orders: "/orders" + suffix,
      stock: "/stock" + suffix,
      movements: "/stock/movements" + suffix,
      payments: "/payments" + suffix,
      cash: "/cash" + suffix,
      expenses: "/expenses" + suffix,
      deliveries: "/deliveries" + suffix,
      visits: "/visits",
      purchases: "/purchases" + suffix,
      promotions: "/promotions",
      overview: "/reports/overview" + (entity ? "?entity_id=" + entity : ""),
      alerts: "/alerts",
      attention: "/attention?entity_id=" + entity,
    };
    const access = {
      users: ["owner"],
      maintenance: ["owner"],
      products: ["seller", "manager", "rep", "accountant", "warehouse"],
      clients: ["seller", "manager", "rep", "accountant"],
      orders: [
        "seller",
        "manager",
        "rep",
        "accountant",
        "warehouse",
        "dispatcher",
      ],
      stock: ["warehouse", "accountant", "seller", "manager", "rep"],
      movements: ["warehouse", "accountant"],
      payments: ["accountant", "seller", "manager", "rep", "courier"],
      cash: ["accountant", "rep", "courier", "seller"],
      expenses: ["accountant"],
      deliveries: ["dispatcher", "courier"],
      visits: ["rep"],
      purchases: ["accountant", "warehouse"],
      promotions: ["accountant", "seller", "manager", "rep"],
      overview: ["accountant"],
      alerts: ["owner"],
      attention: ["accountant"],
    };
    setLoading(true);
    const entries = Object.entries(endpoints).filter(
      ([key]) =>
        auth.roles.includes("owner") ||
        access[key]?.some((role) => auth.roles.includes(role)),
    );
    const results = await Promise.allSettled(
      entries.map(([, url]) => api(url)),
    );
    if (g !== generation.current) return;
    const next = {},
      errs = {};
    results.forEach((r, i) => {
      const k = entries[i][0];
      if (r.status === "fulfilled") next[k] = r.value;
      else if (r.reason.status !== 403) errs[k] = r.reason.message;
    });
    setData(next);
    setErrors(errs);
    setLoading(false);
  }, [auth, entity, warehouse]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(id);
  }, [toast]);
  const mutate = async (path, body = {}, method = "POST") => {
    const result = await api(path, { method, body });
    await refresh();
    return result;
  };
  const openPage = (p, target = null) => {
    setNavigationTarget(target ? { ...target, key: Date.now() } : null);
    setPage(p);
    setMobileMenu(false);
  };
  if (boot)
    return (
      <div className="boot">
        <img src="/assets/logo.png" alt="БытМаркет" />
        <p>Подключаем рабочее место…</p>
      </div>
    );
  if (bootError)
    return (
      <div className="auth-shell">
        <Empty
          title="Сервер недоступен"
          action={<Button onClick={bootstrap}>Повторить подключение</Button>}
        >
          {bootError}
        </Empty>
      </div>
    );
  if (!auth)
    return (
      <Auth
        setup={setup}
        onLogin={(result) => {
          setAuth(result.user);
          setCsrf(result.csrf);
          setPage("home");
          setSetup(false);
        }}
      />
    );
  const allowed = (p) =>
    (p === "visits" && has("rep")) ||
    p === "home" ||
    (p === "products" &&
      has("seller", "manager", "rep", "accountant", "warehouse")) ||
    (p === "clients" && has("seller", "manager", "rep", "accountant")) ||
    (p === "orders" &&
      has("seller", "manager", "rep", "accountant", "warehouse")) ||
    (p === "stock" && has("warehouse", "accountant")) ||
    (p === "purchases" && has("accountant", "warehouse")) ||
    (p === "finance" &&
      has("seller", "manager", "rep", "accountant", "courier")) ||
    (p === "deliveries" && has("dispatcher", "courier")) ||
    (p === "reports" && has("accountant")) ||
    (p === "settings" && has());
  const home = roles.includes("owner") ? (
    <Dashboard />
  ) : roles.includes("rep") ? (
    <Visits />
  ) : roles.includes("courier") || roles.includes("dispatcher") ? (
    <Deliveries />
  ) : roles.includes("accountant") ? (
    <Finance />
  ) : roles.includes("warehouse") ? (
    <Stock />
  ) : (
    <Orders />
  );
  const pages = {
    home,
    visits: <Visits />,
    orders: <Orders />,
    products: <Products />,
    clients: <Clients />,
    stock: <Stock />,
    purchases: <Purchases />,
    finance: <Finance />,
    deliveries: <Deliveries />,
    reports: <Overview reportOnly />,
    settings: <Administration />,
  };
  const value = {
    auth,
    meta,
    data,
    errors,
    entity,
    warehouse,
    has,
    refresh,
    mutate,
    setToast,
    openPage,
    navigationTarget,
    online,
    loading,
  };
  return (
    <CRMContext.Provider value={value}>
      <div className="app-shell">
        <AppNav
          coach={false}
          activeKey={page}
          onSelect={openPage}
          user={{
            name: auth.name,
            role: roles.map((r) => roleNames[r] || r).join(", "),
          }}
          brand={{ name: "Розница и опт · Астрахань" }}
          footerSlot={
            auth.demo ? (
              <select
                aria-label="Выбрать роль"
                className="bm-demo-role"
                value={roles[0]}
                onChange={async (event) => {
                  const role = event.target.value;
                  try {
                    await api("/auth/demo", { method: "POST", body: { role } });
                    window.location.reload();
                  } catch (e) {
                    setToast(e.message);
                  }
                }}
              >
                {Object.entries(roleNames).map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </select>
            ) : undefined
          }
          onLogout={
            auth.demo
              ? undefined
              : async () => {
                  try {
                    await api("/auth/logout", { method: "POST", body: {} });
                    reset();
                  } catch (e) {
                    setToast(e.message);
                  }
                }
          }
          groups={[
            {
              key: "today",
              title: "Сегодня",
              tone: "ember",
              items: [
                {
                  key: "home",
                  label: roles.includes("owner")
                    ? "Обзор"
                    : roles.includes("rep")
                      ? "Мой день"
                      : "Моё рабочее место",
                  icon: LayoutDashboard,
                },
                ...(allowed("visits")
                  ? [
                      {
                        key: "visits",
                        label: "Визиты и акции",
                        icon: CalendarDays,
                      },
                    ]
                  : []),
              ],
            },
            {
              key: "trade",
              title: "Торговля",
              tone: "sky",
              items: nav
                .filter(
                  ([id]) =>
                    ["orders", "clients", "deliveries"].includes(id) &&
                    allowed(id),
                )
                .map(([key, label, icon]) => ({ key, label, icon })),
            },
            {
              key: "goods",
              title: "Товар и склад",
              tone: "gold",
              items: nav
                .filter(
                  ([id]) =>
                    ["products", "stock", "purchases"].includes(id) &&
                    allowed(id),
                )
                .map(([key, label, icon]) => ({ key, label, icon })),
            },
            {
              key: "control",
              title: "Управление",
              tone: "lime",
              items: nav
                .filter(
                  ([id]) => ["finance", "reports"].includes(id) && allowed(id),
                )
                .map(([key, label, icon]) => ({ key, label, icon })),
            },
            {
              key: "system",
              separator: true,
              items: allowed("settings")
                ? [{ key: "settings", label: "Настройки", icon: Settings }]
                : [],
            },
          ]}
          badges={{
            stock: {
              text:
                (data.alerts || []).filter(
                  (a) => a.status === "open" && a.entity_id === entity,
                ).length + " ниже порога",
              tone: "warn",
            },
            orders: {
              text:
                (data.orders || []).filter((o) =>
                  ["confirmed", "partially_shipped"].includes(o.status),
                ).length + " в работе",
              tone: "info",
            },
          }}
        />
        <div className="workspace bm-workspace">
          <header className="p-head p-head--opaque">
            <div className="p-head__menu">
              <NavMark
                badge={(data.alerts || []).some(
                  (a) => a.status === "open" && a.entity_id === entity,
                )}
              />
            </div>
            <h1 className="p-head__title">
              {page === "home"
                ? roles.includes("owner")
                  ? "Обзор"
                  : roles.includes("rep")
                    ? "Мой день"
                    : "Моё рабочее место"
                : page === "visits"
                  ? "Визиты и акции"
                  : nav.find((n) => n[0] === page)?.[1]}
            </h1>
            <GlobalSearch />
            <HeadSlotTarget style={{ display: "flex" }} />
          </header>
          <div className="bm-contextbar">
            <label>
              Организация{" "}
              <select
                aria-label="Организация"
                value={entity}
                onChange={(e) => {
                  setData({});
                  setEntity(e.target.value);
                }}
              >
                {meta.entities?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="bm-context-divider" />
            <label>
              Склад{" "}
              <select
                aria-label="Склад"
                value={warehouse}
                onChange={(e) => {
                  setData({});
                  setWarehouse(e.target.value);
                }}
              >
                {meta.warehouses?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="bm-refresh"
              onClick={refresh}
              disabled={loading}
              aria-label="Обновить данные"
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
              <span>{loading ? "Обновляем" : "Обновить"}</span>
            </button>
          </div>
          <main>
            {!online && (
              <div className="warning" role="status">
                Нет связи. Черновик продажи хранится на этом устройстве. Резерв
                и оплата без сервера не создаются.
              </div>
            )}
            {errors.meta && <div className="error-box">{errors.meta}</div>}
            {Object.keys(errors).filter((k) => k !== "meta").length > 0 && (
              <details className="load-errors">
                <summary>Не все данные удалось загрузить</summary>
                {Object.entries(errors).map(([k, v]) => (
                  <p key={k}>{v}</p>
                ))}
                <Button onClick={refresh}>Повторить</Button>
              </details>
            )}
            {allowed(page) ? (
              <PageBoundary key={page} onRecover={refresh}>
                <TradingWorkspace page={page}>{pages[page]}</TradingWorkspace>
              </PageBoundary>
            ) : (
              <Empty title="Раздел недоступен">
                Обратитесь к владельцу за доступом.
              </Empty>
            )}
          </main>
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button
              aria-label="Закрыть уведомление"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </CRMContext.Provider>
  );
}
function Auth({ setup, onLogin }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <img className="auth-logo" src="/assets/logo.png" alt="БытМаркет" />
        <h1>{setup ? "Начнём работу" : "Вход в БытМаркет"}</h1>
        <p>
          {setup
            ? "Создайте учётную запись владельца. Товары, клиенты и операции вы добавите после входа."
            : "Ваши заказы, товары и деньги в одном рабочем месте."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const body = Object.fromEntries(new FormData(e.currentTarget));
            try {
              onLogin(
                await api(setup ? "/auth/setup" : "/auth/login", {
                  method: "POST",
                  body,
                }),
              );
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {setup && (
            <Field label="Ваше имя" name="name" required autoComplete="name" />
          )}
          <Field
            label="Электронная почта"
            name="email"
            type="email"
            required
            autoComplete="username"
          />
          <Field
            label="Пароль"
            name="password"
            type="password"
            required
            minLength={setup ? 12 : 1}
            autoComplete={setup ? "new-password" : "current-password"}
          />
          {setup && (
            <small>
              Не менее 12 символов. Сохраните пароль в надёжном месте.
            </small>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <Button primary busy={busy} type="submit">
            {setup ? "Создать рабочее пространство" : "Войти"}
          </Button>
        </form>
        <small>Касса и 1С пока не подключены.</small>
      </div>
    </div>
  );
}

class PageBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <Empty
          title="Не удалось показать раздел"
          action={
            <Button
              onClick={() => {
                this.setState({ failed: false });
                this.props.onRecover();
              }}
            >
              Обновить раздел
            </Button>
          }
        >
          Сохранённые операции остаются на сервере. Обновите раздел; перед
          повтором оплаты проверьте её наличие.
        </Empty>
      );
    return this.props.children;
  }
}
