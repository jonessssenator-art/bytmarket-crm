let csrf = "";
const pendingKeys = new Map();
try {
  for (const entry of JSON.parse(
    sessionStorage.getItem("bytmarket:pending-commands") || "[]",
  ))
    if (Array.isArray(entry) && entry.length === 2) pendingKeys.set(...entry);
} catch {}
function persistPending() {
  try {
    sessionStorage.setItem(
      "bytmarket:pending-commands",
      JSON.stringify([...pendingKeys].filter(([s]) => !s.includes(":/auth/"))),
    );
  } catch {}
}

export function setCsrf(value) {
  csrf = value || "";
}
export async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { Accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const signature = method + ":" + path + ":" + JSON.stringify(options.body);
  if (method !== "GET") {
    if (!pendingKeys.has(signature))
      pendingKeys.set(signature, options.key || crypto.randomUUID());
    headers["X-CSRF-Token"] = csrf;
    headers["Idempotency-Key"] = pendingKeys.get(signature);
    persistPending();
  }
  let response;
  try {
    response = await fetch("/api/v1" + path, {
      credentials: "same-origin",
      ...options,
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error(
      "Нет связи с сервером. Проверьте подключение и повторите действие.",
    );
  }
  const data = await response.json().catch(() => ({}));
  if (response.ok || (response.status >= 400 && response.status < 500)) {
    pendingKeys.delete(signature);
    persistPending();
  }
  if (!response.ok) {
    const error = new Error(
      data.error || `Ошибка запроса (${response.status})`,
    );
    error.status = response.status;
    error.code = data.code;
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw error;
  }
  return data;
}
export const money = (cents) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(Number(cents || 0) / 100);
export function cents(value) {
  const str = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(str))
    throw new Error(
      "Укажите сумму в рублях, не более двух знаков после запятой.",
    );
  const [a, b = ""] = str.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw new Error("Слишком большая сумма.");
  return n;
}
export function csvDownload(name, rows) {
  const text =
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map((v) => {
            let s = String(v ?? "");
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseCsv(text) {
  const delimiter = text.split(/\r?\n/)[0].includes(";") ? ";" : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("В CSV не закрыты кавычки.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((x) =>
    x.replace(/^\ufeff/, "").trim(),
  );
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}
export const labelStatus = (status) =>
  ({
    draft: "Черновик",
    confirmed: "Подтверждён",
    partially_shipped: "Частично отгружен",
    shipped: "Отгружен",
    completed: "Завершён",
    cancelled: "Отменён",
    returned: "Возврат",
    awaiting: "Ожидает назначения",
    assigned: "Назначена",
    in_transit: "В пути",
    delivered: "Доставлено",
    failed: "Не доставлено",
    planned: "Запланирован",
    done: "Выполнен",
    ordered: "Заказано",
    received: "Получено",
    partially_received: "Принято частично",
    closed: "Закрыт",
    pending: "Ожидает подтверждения",
    active: "Активно",
    resolved: "Закрыто",
  })[status] ||
  status ||
  "Не задан";
export const date = (value) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Не задана";
