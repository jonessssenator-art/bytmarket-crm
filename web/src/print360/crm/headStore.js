// CRM Print 360 v2 — общее состояние шапки раздела (без React-контекста, чтобы шапка и разделы
// не перерисовывали друг друга лишний раз).
//   • target — DOM-элемент слота #p-head-slot (его регистрирует <HeadSlotTarget/>);
//   • hidden — счётчик разделов, попросивших спрятать шапку (<HeaderSlot hideHead/>).
import { useSyncExternalStore } from 'react';

export const HEAD_SLOT_ID = 'p-head-slot';

let target = null;
let hideCount = 0;
const subs = new Set();
const emit = () => subs.forEach((fn) => fn());

export const headStore = {
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  /** Элемент слота: зарегистрированный, а если его нет — найденный по id (шапку мог нарисовать кто-то другой) */
  getTarget() {
    if (target && target.isConnected) return target;
    if (typeof document === 'undefined') return null;
    return document.getElementById(HEAD_SLOT_ID);
  },
  setTarget(el) {
    if (target === el) return;
    target = el;
    emit();
  },
  clearTarget(el) {
    if (target !== el) return;
    target = null;
    emit();
  },
  isHidden() {
    return hideCount > 0;
  },
  /** Спрятать шапку; возвращает функцию «вернуть как было» (вызывать один раз) */
  hide() {
    hideCount += 1;
    emit();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      hideCount = Math.max(0, hideCount - 1);
      emit();
    };
  },
};

/** Для шапки App.jsx: true, пока открыт раздел, который попросил спрятать шапку */
export function useHeadHidden() {
  return useSyncExternalStore(headStore.subscribe, headStore.isHidden, () => false);
}
