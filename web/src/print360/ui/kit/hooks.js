// Набор элементов Print 360 — мелкие общие хуки.
import { useCallback, useState } from 'react';

/** Значение, которое можно передать снаружи (value + onChange) или оставить внутри (defaultValue) */
export function useControllable(value, defaultValue, onChange) {
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = useCallback((next) => {
    const v = typeof next === 'function' ? next(current) : next;
    if (!controlled) setInner(v);
    onChange?.(v);
  }, [controlled, current, onChange]);
  return [current, set];
}

/** Склеить несколько ref (объекты и колбэки) в один колбэк */
export function mergeRefs(...refs) {
  // React 19: колбэк, вернувший функцию очистки, при отсоединении получает очистку, а не null —
  // поэтому для «старых» колбэков без очистки сами зовём r(null)
  return (node) => {
    const cleanups = refs.map((r) => {
      if (typeof r === 'function') {
        const c = r(node);
        return typeof c === 'function' ? c : () => r(null);
      }
      if (r && typeof r === 'object') {
        r.current = node;
        return () => { r.current = null; };
      }
      return null;
    });
    return () => cleanups.forEach((c) => c && c());
  };
}

/** Повесить DOM-узел на ref любого вида (объект или колбэк); вернуть очистку */
export function assignRef(r, el) {
  if (!r) return undefined;
  if (typeof r === 'function') {
    const c = r(el);
    return typeof c === 'function' ? c : () => r(null);
  }
  r.current = el;
  return () => { r.current = null; };
}

/** Внутри поля ввода? (чтобы горячие клавиши не мешали печатать) */
export function isTypingTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Все элементы внутри root, на которые можно перейти по Tab */
export function focusables(root) {
  if (!root) return [];
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  return [...root.querySelectorAll(sel)].filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

/** Пользователь просит меньше движения */
export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
