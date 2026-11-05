// Print 360 — автомат «шторки у края» (по образцу GitLab Super Sidebar «peek»).
// Состояния: closed → will-open (курсор ждёт у края, шторка выглядывает) → open → will-close (курсор ушёл) → closed.
// Один общий обработчик pointermove на document: пока курсор внутри одной зоны, он ничего не делает,
// React перерисовывает только при смене состояния. Подсветка язычка (data-near) пишется прямо в DOM.
//
// Защиты от случайных открытий:
//  - ждём openDelay (180 мс) у края; быстрый пролёт вдоль края перезапускает ожидание;
//  - не открываем, пока зажата кнопка мыши (перетаскивание карточек, панорама доски, выделение текста),
//    во время нативного drag-and-drop, от касаний и пера;
//  - не открываем, если у края лежит окно/затемнение (fixed-слой с z-index) или открыт aria-modal/dialog;
//  - после закрытия по Esc/клику мимо не открываем снова, пока курсор не отойдёт от края дальше near (48 px);
//  - гистерезис: открываем у самого края (edge), закрываем, только когда курсор правее шторки + gap (32 px);
//    дальше двух ширин шторки — закрываем сразу; ушли из окна — запускаем таймер, а не закрываем мгновенно.
//
// Два способа открыть мышью (правка Раби 13.10.2026):
//  - навели к краю (by 'hover') — шторка выглядывает и сама прячется, когда мышь ушла, по клику мимо и Esc;
//  - нажали ручку у края или знак в шапке (by 'click') — шторка «вытянута» и остаётся открытой: не прячется ни от ухода
//    мыши, ни от клика мимо, ни от выбора пункта; закрывается только кнопкой «Скрыть» в шторке (close), Esc или Ctrl+\.
//  Над самой ручкой (handleRef) наведение шторку не открывает — ручка выдвигается и ждёт нажатия.
import { useCallback, useEffect, useRef, useState } from 'react';

export const NAV_STATE = { CLOSED: 'closed', WILL_OPEN: 'will-open', OPEN: 'open', WILL_CLOSE: 'will-close' };

// Закрытия «по решению человека» — после них край временно не реагирует
const DELIBERATE = new Set(['esc', 'outside', 'select', 'toggle']);
// Открыли нажатием мыши (ручка, знак в шапке) — шторка «вытянута» и прячется только кнопкой «Скрыть» / Esc / Ctrl+\
export const isStickyOpen = (by) => by === 'click';

export default function useEdgeReveal({
  rootRef,            // корень оболочки меню (язычок + шторка); курсор над ним = «внутри»
  panelRef,           // сама шторка: по ней считаем правую границу
  handleRef,          // ручка у края: над ней наведение не открывает шторку — ждём нажатия
  enabled = true,     // false — меню закреплено: ни край, ни Esc/клик мимо не слушаем
  hover = true,       // false — на устройстве нет мыши: край не слушаем, открываем только кнопкой
  edge = 10,          // ширина горячей полосы у края, px
  near = 48,          // ближе этого язычок «просыпается»
  gap = 32,           // запас справа от шторки до начала закрытия
  openDelay = 180,
  closeDelay = 450,
  onChange,           // (next, prev, by) — вызывается из обработчиков и таймеров, не из эффектов
} = {}) {
  const [state, setState] = useState(NAV_STATE.CLOSED);
  const [openedBy, setOpenedBy] = useState(null);
  const box = useRef({ state: NAV_STATE.CLOSED, by: null, openT: 0, closeT: 0, blocked: false, near: false, drag: false, dwellY: 0 });
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  const go = useCallback((next, by) => {
    const s = box.current;
    const prev = s.state;
    const nextBy = by === undefined ? s.by : by;
    if (prev === next && s.by === nextBy) return false;
    s.state = next;
    s.by = nextBy;
    setState(next);
    setOpenedBy(nextBy);
    changeRef.current?.(next, prev, nextBy);
    return true;
  }, []);

  const clearTimers = useCallback(() => {
    const s = box.current;
    clearTimeout(s.openT);
    clearTimeout(s.closeT);
  }, []);

  const setNear = useCallback((v) => {
    const s = box.current;
    if (s.near === v) return;
    s.near = v;
    const r = rootRef?.current;
    if (r) { if (v) r.setAttribute('data-near', ''); else r.removeAttribute('data-near'); }
  }, [rootRef]);

  const open = useCallback((by = 'click') => {
    clearTimers();
    setNear(false);
    go(NAV_STATE.OPEN, by);
  }, [clearTimers, go, setNear]);

  const close = useCallback((why = 'away') => {
    clearTimers();
    if (DELIBERATE.has(why)) box.current.blocked = true;
    go(NAV_STATE.CLOSED, null);
  }, [clearTimers, go]);

  const toggle = useCallback((by = 'click') => {
    const st = box.current.state;
    if (st === NAV_STATE.OPEN || st === NAV_STATE.WILL_CLOSE) close('toggle');
    else open(by);
  }, [open, close]);

  useEffect(() => {
    if (!enabled || !hover) return undefined;
    const s = box.current;

    const rightEdge = () => {
      const p = panelRef?.current;
      return p ? p.offsetLeft + p.offsetWidth : 308; // offset* не учитывают transform — берём «открытое» место
    };
    const inside = (t) => !!t && t.nodeType === 1
      && ((rootRef?.current && rootRef.current.contains(t)) || !!t.closest('[data-p-nav-keep]'));
    // Человек печатает в поле внутри шторки — не закрываем её из-за мыши
    const typingInside = () => {
      const a = document.activeElement;
      return !!a && inside(a) && (a.matches('input, textarea, select') || a.isContentEditable);
    };
    // У края лежит окно или затемнение — шторку не показываем
    const layerAtEdge = (y) => {
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return true;
      const el = document.elementFromPoint(2, y);
      if (!el || inside(el)) return false;
      for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.position === 'fixed') {
          const z = parseInt(cs.zIndex, 10);
          return Number.isFinite(z) && z > 0;
        }
      }
      return false;
    };

    const startWillOpen = (y) => {
      if (!go(NAV_STATE.WILL_OPEN, 'hover')) return;
      s.dwellY = y;
      s.openT = setTimeout(() => { if (s.state === NAV_STATE.WILL_OPEN) go(NAV_STATE.OPEN, 'hover'); }, openDelay);
    };
    const startWillClose = () => {
      if (!go(NAV_STATE.WILL_CLOSE)) return;
      s.closeT = setTimeout(() => { if (s.state === NAV_STATE.WILL_CLOSE) go(NAV_STATE.CLOSED, null); }, closeDelay);
    };
    // прячется от ухода мыши только шторка, открытая наведением (вытянутая нажатием — нет)
    const hoverMode = () => s.by === 'hover';
    // курсор на ручке (по высоте ручки у самого края) — там ждём нажатия, а не наведения
    const onHandle = (e) => {
      const h = handleRef?.current;
      if (!h) return false;
      if (h.contains(e.target)) return true;
      const r = h.getBoundingClientRect();
      return e.clientX <= r.right + 14 && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    // слушатели переподключились (открепили меню, вернулась мышь) посреди ожидания — довести его до конца
    if (s.state === NAV_STATE.WILL_OPEN) s.openT = setTimeout(() => { if (s.state === NAV_STATE.WILL_OPEN) go(NAV_STATE.OPEN, 'hover'); }, openDelay);
    if (s.state === NAV_STATE.WILL_CLOSE) s.closeT = setTimeout(() => { if (s.state === NAV_STATE.WILL_CLOSE) go(NAV_STATE.CLOSED, null); }, closeDelay);

    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return; // касание и перо — только по кнопке
      const x = e.clientX;
      if (e.buttons === 0) s.drag = false;
      if (s.blocked && x > near) s.blocked = false;
      setNear(s.state === NAV_STATE.CLOSED && x < near && !s.blocked && e.buttons === 0);

      switch (s.state) {
        case NAV_STATE.CLOSED:
          // html[data-dragging] — доска из src/ui/kit тащит карточку или панорамирует (в т.ч. с клавиатуры)
          if (x <= edge && !s.blocked && e.buttons === 0 && !s.drag && !document.documentElement.hasAttribute('data-dragging') && !onHandle(e) && !layerAtEdge(e.clientY)) startWillOpen(e.clientY);
          break;
        case NAV_STATE.WILL_OPEN:
          if (x > edge + 14 || e.buttons !== 0 || onHandle(e)) { clearTimers(); go(NAV_STATE.CLOSED, null); break; }
          // быстрый пролёт вдоль края — ждём заново, пока курсор не успокоится
          if (Math.abs(e.clientY - s.dwellY) > 80) {
            s.dwellY = e.clientY;
            clearTimeout(s.openT);
            s.openT = setTimeout(() => { if (s.state === NAV_STATE.WILL_OPEN) go(NAV_STATE.OPEN, 'hover'); }, openDelay);
          }
          break;
        case NAV_STATE.OPEN: {
          if (!hoverMode() || inside(e.target) || typingInside()) break;
          const r = rightEdge();
          if (x > r * 2) { clearTimers(); go(NAV_STATE.CLOSED, null); } else if (x > r + gap) startWillClose();
          break;
        }
        case NAV_STATE.WILL_CLOSE: {
          const r = rightEdge();
          if (inside(e.target) || x <= r + gap) { clearTimers(); go(NAV_STATE.OPEN); } else if (x > r * 2) { clearTimers(); go(NAV_STATE.CLOSED, null); }
          break;
        }
        default:
      }
    };

    // Курсор ушёл из окна: ожидание у края отменяем, открытую шторку закрываем с задержкой
    const onOut = (e) => {
      if (e.relatedTarget) return;
      setNear(false);
      if (s.state === NAV_STATE.WILL_OPEN) { clearTimers(); go(NAV_STATE.CLOSED, null); } else if (s.state === NAV_STATE.OPEN && hoverMode()) startWillClose();
    };
    const onBlur = () => { if (s.state === NAV_STATE.WILL_OPEN) { clearTimers(); go(NAV_STATE.CLOSED, null); } };
    const onDragStart = () => { s.drag = true; };
    const onDragEnd = () => { s.drag = false; };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onOut);
    document.addEventListener('dragstart', onDragStart, true);
    document.addEventListener('dragend', onDragEnd, true);
    document.addEventListener('drop', onDragEnd, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('dragstart', onDragStart, true);
      document.removeEventListener('dragend', onDragEnd, true);
      document.removeEventListener('drop', onDragEnd, true);
      window.removeEventListener('blur', onBlur);
      clearTimers();
      setNear(false);
    };
  }, [enabled, hover, edge, near, gap, openDelay, closeDelay, rootRef, panelRef, handleRef, go, clearTimers, setNear]);

  // Esc и клик мимо — закрыть сразу (клик проходит дальше, как в GitLab). Работает и без мыши (планшет).
  // Вытянутую нажатием шторку клик мимо не закрывает — только «Скрыть», Esc или Ctrl+\.
  useEffect(() => {
    if (!enabled) return undefined;
    const s = box.current;
    const inside = (t) => !!t && t.nodeType === 1
      && ((rootRef?.current && rootRef.current.contains(t)) || !!t.closest('[data-p-nav-keep]'));
    const onDown = (e) => {
      if ((s.state === NAV_STATE.OPEN || s.state === NAV_STATE.WILL_CLOSE) && !isStickyOpen(s.by) && !inside(e.target)) close('outside');
    };
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || s.state === NAV_STATE.CLOSED) return;
      close('esc');
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [enabled, rootRef, close]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { state, openedBy, open, close, toggle };
}
