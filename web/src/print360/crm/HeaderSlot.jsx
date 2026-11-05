// CRM Print 360 v2 — шапка раздела.
//
// Шапку рисует App.jsx: кнопка меню + заголовок пункта + слот #p-head-slot (<HeadSlotTarget/>).
// Всё остальное (поиск, переключатели, кнопки действий) раздел кладёт сам:
//
//   <HeaderSlot>
//     <SearchField … />
//     <Button icon="plus">Сделка</Button>
//   </HeaderSlot>
//
//   <HeaderSlot hideHead />   — спрятать шапку целиком, пока раздел открыт (полноэкранные разделы)
//
// Слот может появиться позже раздела (шапку перерисовали, раздел грузится раньше) — HeaderSlot
// дождётся его. Нет слота — ничего не рисует. Несколько HeaderSlot одновременно — дети встают
// в порядке монтирования; надёжнее держать один HeaderSlot на раздел.
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { headStore, HEAD_SLOT_ID } from './headStore.js';

export function HeaderSlot({ children = null, hideHead = false }) {
  const [el, setEl] = useState(() => headStore.getTarget());

  useLayoutEffect(() => {
    const sync = () => {
      const t = headStore.getTarget();
      setEl((prev) => (prev === t ? prev : t));
      return t;
    };
    sync();
    const unsub = headStore.subscribe(sync);
    // Слота пока нет в DOM — ждём, когда он появится (по id), и сразу перестаём следить
    let mo = null;
    if (!headStore.getTarget() && typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        if (sync() && mo) { mo.disconnect(); mo = null; }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
    return () => { unsub(); if (mo) mo.disconnect(); };
  }, []);

  useLayoutEffect(() => {
    if (!hideHead) return undefined;
    return headStore.hide();
  }, [hideHead]);

  if (!el || el.isConnected === false || children === null || children === undefined || children === false) return null;
  return createPortal(children, el);
}

// Ссылка-регистратор слота: одна на всё приложение (стабильная — React не перевешивает её на каждом рендере)
function registerHeadSlot(el) {
  if (el) headStore.setTarget(el);
  return () => headStore.clearTarget(el);
}

/**
 * Сам слот в шапке. App.jsx ставит его после заголовка. По умолчанию display: contents — дети
 * раздела ведут себя как прямые элементы шапки (как было до выноса веток шапки в разделы).
 */
export function HeadSlotTarget({ className = 'p-head__slot', style }) {
  return <div id={HEAD_SLOT_ID} ref={registerHeadSlot} className={className} style={{ display: 'contents', ...style }} />;
}
