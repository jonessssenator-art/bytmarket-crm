// Print 360 — формат чисел для эффектов и графиков (ru-RU, неразрывные пробелы, типографский минус).
// Внутренний помощник src/ui/fx и src/ui/charts; разделы берут форматтеры из src/config/format.js.

export const NBSP = '\u00A0';
export const MINUS = '\u2212';
const cache = new Map();

function nf(opts) {
  const key = JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', opts);
    cache.set(key, f);
  }
  return f;
}

/** Опции Intl для формата Num/графиков: 'int' | 'num' | 'money' | 'pct' (pct: 40 → «40%», а не 0,4) */
export function intlOptions(format = 'int', { decimals, compact = false, signed = false } = {}) {
  const max = decimals ?? (format === 'num' ? 1 : 0);
  const o = { maximumFractionDigits: compact ? (decimals ?? 1) : max };
  if (decimals != null && !compact) o.minimumFractionDigits = decimals;
  if (compact) { o.notation = 'compact'; o.compactDisplay = 'short'; }
  if (signed) o.signDisplay = 'exceptZero';
  return o;
}

/** Число строкой: formatNumber(1284000) → «1 284 000»; ({ compact: true }) → «1,3 млн» */
export function formatNumber(value, { format = 'int', decimals, compact = false, signed = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const s = nf(intlOptions(format, { decimals, compact, signed })).format(n);
  return s.replace(/-/g, MINUS).replace(/\u202F/g, NBSP);
}

/** «84 300 ₽», «+24 300 ₽», «−5 000 ₽» */
export function formatMoney(value, opts = {}) {
  const s = formatNumber(value, { format: 'money', ...opts });
  return s === '—' ? s : `${s}${NBSP}₽`;
}

/** Подписи осей и коротких сумм: 1 284 000 → «1,3 млн», 84 300 → «84,3 тыс.» */
export function formatCompact(value, { money = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const s = abs >= 10000 ? formatNumber(n, { compact: true, decimals: abs >= 1e6 ? 1 : 0 }) : formatNumber(n);
  return money ? `${s}${NBSP}₽` : s;
}

/** Склонение по числу: plural(3, ['заказ', 'заказа', 'заказов']) → 'заказа'. Строка вместо массива — как есть */
export function plural(n, forms) {
  if (!Array.isArray(forms)) return forms ?? '';
  const a = Math.abs(Math.trunc(Number(n) || 0)) % 100, b = a % 10;
  if (!Number.isInteger(Number(n))) return forms[1];
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Значение по формату + единица — для подсказок и подписей: fmtValue(84300, 'money') → «84 300 ₽»;
    unit — строка или три формы: fmtValue(3, 'int', { unit: ['заказ', 'заказа', 'заказов'] }) → «3 заказа» */
export function fmtValue(value, format = 'int', { decimals, unit } = {}) {
  if (format === 'money') return formatMoney(value, { decimals });
  if (format === 'pct') return `${formatNumber(value, { format: 'pct', decimals })}%`;
  const s = formatNumber(value, { format, decimals });
  const u = plural(value, unit);
  return u ? `${s}${NBSP}${u}` : s;
}

/** Доля в процентах строкой: fmtShare(3, 200) → «1,5%», fmtShare(25, 200) → «13%» (дробь — только если меньше 10) */
export function fmtShare(part, total) {
  const t = Number(total) || 0;
  if (!t) return '0%';
  const p = (Number(part) / t) * 100;
  return `${formatNumber(p, { format: 'num', decimals: p < 10 && p > 0 ? 1 : 0 })}%`;
}
