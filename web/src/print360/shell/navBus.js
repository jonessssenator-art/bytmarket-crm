// Print 360 — «шина» шторки меню. Шапка раздела (NavMark), поиск, подсказки и любые разделы
// открывают меню через openNav()/toggleNav(), ничего не зная про AppNav и не трогая AtmCrm.
// AppNav слушает события window и публикует своё состояние (для aria-expanded у знака в шапке).

export const NAV_EVENTS = {
  open: 'p360:nav-open',
  close: 'p360:nav-close',
  toggle: 'p360:nav-toggle',
  state: 'p360:nav-state',
};

// Подпись клавиши-модификатора в подсказках: на Mac — ⌘, иначе Ctrl
export const NAV_MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl';

// detail.by — как открыли: 'click' | 'keyboard' | 'touch' (от этого зависит, закрывать ли шторку при уходе мыши)
const fire = (name, detail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
};
export const openNav = (detail) => fire(NAV_EVENTS.open, detail);
export const closeNav = (detail) => fire(NAV_EVENTS.close, detail);
export const toggleNav = (detail) => fire(NAV_EVENTS.toggle, detail);

// Текущее состояние шторки: { state: 'open' | 'closed', pinned }
let snapshot = { state: 'closed', pinned: false };
const subs = new Set();

export function publishNavState(next) {
  const merged = { ...snapshot, ...next };
  if (merged.state === snapshot.state && merged.pinned === snapshot.pinned) return;
  snapshot = merged;
  subs.forEach((fn) => fn());
  fire(NAV_EVENTS.state, snapshot);
}
export const getNavSnapshot = () => snapshot;
export function subscribeNav(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
