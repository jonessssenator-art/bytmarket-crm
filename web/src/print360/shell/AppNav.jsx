// Print 360 — боковое меню-«шторка» (v2, 13.10.2026). Замена Sidebar.jsx.
// По умолчанию спрятано: у левого края — ручка (тёмное стекло со стрелкой «›»). Шторка выезжает поверх контента:
//  - курсор задержался у края (useEdgeReveal) — выглядывает и сама прячется, когда мышь ушла;
//  - нажали ручку или знак в шапке (NavMark / openNav()) — «вытянута» и остаётся открытой, пока не нажали «Скрыть»
//    в шапке шторки (или Esc, Ctrl+\ / ⌘+\). Правка Раби 13.10.2026.
// Закреплённая шторка стоит на месте и сдвигает контент: AppNav ставит на <html> атрибут data-nav-pinned
// и переменную --p-nav-offset (320px) — главной колонке достаточно padding-left: var(--p-nav-offset, 0px).
//
// Договор с App.jsx (как у Sidebar): группы и пункты собирает App с учётом прав, шторка только рисует.
// Состояние наведения и открытия живёт ВНУТРИ компонента — движение мыши у края не перерисовывает AtmCrm.
//
// Пропсы: groups [{ key, title, tone, color, separator?, items: [{ key, label, icon, iconFallback, views }] }] — как в navConfig.js, activeKey, onSelect(key),
// user { name, role, demo? }, onLogout, footerSlot (в демо — <DemoSwitcher/>), badges { [key]: 'текст' | { text, tone } },
// pinned / onPinnedChange (если pinned не передан — шторка сама помнит выбор в localStorage «bytmarket_nav_pinned»),
// brand { name, logoUrl } (название типографии из Настроек; нет — логотип Print 360), onSearch (кнопка поиска, по желанию).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Avatar, Wordmark } from '../ui/index.jsx';
import { roleLabel } from '../ui/tokens.js';
import ShellIcon from './shellIcons.jsx';
import useEdgeReveal, { NAV_STATE, isStickyOpen } from './useEdgeReveal.js';
import { NAV_EVENTS, NAV_MOD_KEY, publishNavState } from './navBus.js';
import { badgeOf } from './navColors.js';
import './nav.css';

const PIN_KEY = 'bytmarket_nav_pinned';
const COACH_KEY = 'bytmarket_coach_nav';
const NAV_OFFSET = 320; // 12 отступ + 296 шторка + 12 зазор

const readLS = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const writeLS = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* приватный режим — не помним */ } };

// matchMedia без перерисовок родителя
function useMedia(query, fallback) {
  const subscribe = useCallback((cb) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  }, [query]);
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, get, () => fallback);
}

// «Как открыли» по событию клика: касание → 'touch', клавиатура (detail 0) → 'keyboard', иначе мышь
const openedByOf = (e, lastPointer) => {
  const pt = e?.nativeEvent?.pointerType || lastPointer;
  if (pt === 'touch' || pt === 'pen') return 'touch';
  if (e && e.detail === 0) return 'keyboard';
  return 'click';
};

function NavBrand({ brand }) {
  // Раби, 14.10.2026: крупно — название CRM «Print 360», мелко — чья это CRM (типография из Настроек)
  return (
    <div className="p-nav__brand is-wordmark">
      <span className="p-nav__brand-txt">
        <Wordmark height={23} color="var(--p-nav-ink)" />
        <span className="p-nav__brand-sub" title={brand?.name || undefined}>{brand?.name || 'Управление торговлей'}</span>
      </span>
    </div>
  );
}

export default function AppNav({
  groups = [], activeKey, onSelect, user, onLogout, footerSlot, badges,
  pinned: pinnedProp, onPinnedChange, brand, onSearch, coach: coachEnabled = true, className,
}) {
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const handleRef = useRef(null);
  const pillRef = useRef(null);
  const hoverRef = useRef(null);
  const lastFocusRef = useRef(null);
  const lastPointerRef = useRef('mouse');
  const closeTimer = useRef(0);

  const canHover = useMedia('(hover: hover) and (pointer: fine)', true);
  const wide = useMedia('(min-width: 1024px)', true);

  // Закрепление: управляемое (проп pinned) или своё (localStorage)
  const [pinState, setPinState] = useState(() => (pinnedProp !== undefined ? !!pinnedProp : readLS(PIN_KEY) === '1'));
  const [prevPinProp, setPrevPinProp] = useState(pinnedProp);
  if (pinnedProp !== prevPinProp) {
    setPrevPinProp(pinnedProp);
    if (pinnedProp !== undefined) setPinState(!!pinnedProp);
  }
  const pinned = pinState && wide; // на узком экране закреплённое меню съело бы работу — тогда оно просто выезжает

  const [coach, setCoach] = useState(() => coachEnabled && readLS(COACH_KEY) !== '1');
  // Закреплено при загрузке — пункты не «въезжают» заново, просто стоят
  const [instant, setInstant] = useState(pinned);

  const onNavChange = useCallback((next) => {
    if (next === NAV_STATE.OPEN) { setCoach(false); writeLS(COACH_KEY, '1'); }
    if (next === NAV_STATE.CLOSED) setInstant(false);
  }, []);

  const { state, openedBy, open, close, toggle } = useEdgeReveal({
    rootRef, panelRef, handleRef, enabled: !pinned, hover: canHover, onChange: onNavChange,
  });
  const shown = pinned || state === NAV_STATE.OPEN || state === NAV_STATE.WILL_CLOSE;
  const scrim = shown && !pinned && openedBy === 'touch';

  // ---------- строки меню: подписи групп, разделители, пункты (плоский список — для позиций «таблеток») ----------
  const { rows, activeRow, lastIndex } = useMemo(() => {
    const list = (groups || []).filter((g) => g && (g.items || []).some(Boolean));
    const total = list.reduce((n, g) => n + g.items.filter(Boolean).length, 0);
    const flat = total <= 6; // у дизайнера и цеха 2–4 пункта — без подписей групп
    const out = [];
    let i = 1; // 0 — шапка шторки
    list.forEach((g, gi) => {
      if (!flat && gi > 0 && (g.separator || !g.title)) out.push({ type: 'sep', id: `sep-${g.key || gi}`, i: i++ });
      else if (!flat && g.title) out.push({ type: 'label', id: `grp-${g.key || gi}`, title: g.title, i: i++ });
      g.items.filter(Boolean).forEach((it) => out.push({ type: 'item', id: it.key, item: it, i: i++ }));
    });
    return { rows: out, activeRow: out.find((r) => r.type === 'item' && r.item.key === activeKey) || null, lastIndex: i };
  }, [groups, activeKey]);

  // ---------- состояние наружу: знак в шапке (aria-expanded), отступ контента при закреплении ----------
  useEffect(() => { publishNavState({ state: shown ? 'open' : 'closed', pinned }); }, [shown, pinned]);

  useLayoutEffect(() => {
    const de = document.documentElement;
    if (pinned) { de.setAttribute('data-nav-pinned', ''); de.style.setProperty('--p-nav-offset', `${NAV_OFFSET}px`); } else { de.removeAttribute('data-nav-pinned'); de.style.setProperty('--p-nav-offset', '0px'); }
  }, [pinned]);
  useEffect(() => () => {
    const de = document.documentElement;
    de.removeAttribute('data-nav-pinned');
    de.style.removeProperty('--p-nav-offset');
    clearTimeout(closeTimer.current);
  }, []);

  // ---------- фокус ----------
  const focusActive = useCallback(() => {
    const p = panelRef.current;
    if (!p) return;
    const el = p.querySelector('[data-nav-item][data-active]') || p.querySelector('[data-nav-item]');
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);
  const rememberFocus = () => {
    const a = document.activeElement;
    if (a && a !== document.body && !rootRef.current?.contains(a)) lastFocusRef.current = a;
  };

  // открыли с клавиатуры — фокус на текущий раздел
  useEffect(() => {
    if (state !== NAV_STATE.OPEN || openedBy !== 'keyboard') return undefined;
    const raf = requestAnimationFrame(focusActive);
    return () => cancelAnimationFrame(raf);
  }, [state, openedBy, focusActive]);

  // закрыли, а фокус остался внутри (Esc, выбор с клавиатуры) — вернуть туда, где он был
  useEffect(() => {
    if (shown) return;
    const p = panelRef.current;
    if (!p || !p.contains(document.activeElement)) return;
    const back = lastFocusRef.current;
    if (back && back.isConnected) back.focus({ preventScroll: true }); else document.activeElement.blur();
  }, [shown]);

  // ---------- закрепление ----------
  const setPinned = useCallback((next) => {
    setPinState(next);
    writeLS(PIN_KEY, next ? '1' : '0');
    onPinnedChange?.(next);
    if (!next) open('hover'); // открепили — шторка остаётся, пока курсор над ней
  }, [onPinnedChange, open]);

  // ---------- команды извне (NavMark, поиск, подсказки) и горячие клавиши ----------
  useEffect(() => {
    const onOpen = (e) => {
      rememberFocus();
      if (pinned) { focusActive(); return; }
      open(e.detail?.by || 'click');
    };
    const onClose = () => { if (!pinned) close('toggle'); };
    const onToggle = (e) => {
      rememberFocus();
      if (pinned) { focusActive(); return; }
      toggle(e.detail?.by || 'click');
    };
    // Ctrl+\ / ⌘+\ — открыть или закрыть; с Shift — закрепить. По event.code: работает и в русской раскладке
    const onKey = (e) => {
      if (e.code !== 'Backslash' || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      e.preventDefault();
      if (e.shiftKey) { if (wide) setPinned(!pinned); return; }
      if (pinned) {
        if (rootRef.current?.contains(document.activeElement)) {
          const back = lastFocusRef.current;
          if (back && back.isConnected) back.focus({ preventScroll: true }); else document.activeElement.blur();
        } else { rememberFocus(); focusActive(); }
        return;
      }
      rememberFocus();
      toggle('keyboard');
    };
    window.addEventListener(NAV_EVENTS.open, onOpen);
    window.addEventListener(NAV_EVENTS.close, onClose);
    window.addEventListener(NAV_EVENTS.toggle, onToggle);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(NAV_EVENTS.open, onOpen);
      window.removeEventListener(NAV_EVENTS.close, onClose);
      window.removeEventListener(NAV_EVENTS.toggle, onToggle);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned, wide, open, close, toggle, focusActive, setPinned]);

  // ---------- «таблетки»: активный пункт и подсветка наведения (пишем прямо в DOM, без перерисовок) ----------
  const placePill = useCallback((pill, item, animate) => {
    if (!pill) return;
    if (!item) { pill.removeAttribute('data-on'); return; }
    const jump = !animate || !pill.hasAttribute('data-on');
    if (jump) pill.setAttribute('data-jump', '');
    pill.style.transform = `translateY(${item.offsetTop}px)`;
    pill.style.height = `${item.offsetHeight}px`;
    if (jump) { void pill.offsetWidth; pill.removeAttribute('data-jump'); }
    pill.setAttribute('data-on', '');
  }, []);

  const activeItemEl = useCallback(() => {
    const list = listRef.current;
    if (!list || !activeKey) return null;
    return [...list.querySelectorAll('[data-nav-item]')].find((el) => el.dataset.navKey === String(activeKey)) || null;
  }, [activeKey]);

  useLayoutEffect(() => { placePill(pillRef.current, activeItemEl(), true); }, [activeItemEl, rows, placePill]);

  // размер списка поменялся (высота окна, компактный режим) — переставить без анимации
  const relayoutRef = useRef(() => {});
  useEffect(() => {
    relayoutRef.current = () => { placePill(pillRef.current, activeItemEl(), false); hoverRef.current?.removeAttribute('data-on'); };
  }, [activeItemEl, placePill]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    let first = true;
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } relayoutRef.current(); });
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  const onListOver = (e) => {
    const it = e.target.closest?.('[data-nav-item]');
    if (!it || !listRef.current?.contains(it) || it.hasAttribute('data-active')) { hoverRef.current?.removeAttribute('data-on'); return; }
    placePill(hoverRef.current, it, true);
  };
  const onListLeave = () => hoverRef.current?.removeAttribute('data-on');

  // стрелки ↑↓, Home/End — по пунктам меню
  const onPanelKey = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(panelRef.current?.querySelectorAll('[data-nav-item]') || [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    let next = 0;
    if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    items[next].focus({ preventScroll: true });
    items[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // ---------- действия ----------
  const select = (key, e) => {
    onSelect?.(key);
    if (pinned || isStickyOpen(openedBy)) return; // закреплено или вытянуто нажатием — остаётся до «Скрыть»
    if (e.detail !== 0) e.currentTarget.blur();
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => close('select'), 120); // успеть увидеть, как переехала подсветка
  };
  const openFrom = (e) => { rememberFocus(); open(openedByOf(e, lastPointerRef.current)); };
  const hide = () => { clearTimeout(closeTimer.current); close('toggle'); };
  const dismissCoach = () => { setCoach(false); writeLS(COACH_KEY, '1'); };

  const name = user?.name || 'Сотрудник';
  const role = user?.roleLabel || roleLabel(user?.role);

  return (
    <div
      ref={rootRef}
      className={`p-navx no-print${className ? ` ${className}` : ''}`}
      data-p-shell=""
      data-state={pinned ? 'open' : state}
      data-shown={shown ? '' : undefined}
      data-pinned={pinned ? '' : undefined}
      data-instant={instant ? '' : undefined}
      data-coach={coach && !shown ? '' : undefined}
      onPointerDownCapture={(e) => { lastPointerRef.current = e.pointerType; }}
    >
      {/* ручка у края: нажали — меню вытянуто и остаётся, пока не нажали «Скрыть» */}
      <button ref={handleRef} type="button" className="p-nav-handle" aria-label="Открыть меню"
        title={`Открыть меню · ${NAV_MOD_KEY} \\`} tabIndex={shown ? -1 : 0} onClick={openFrom}>
        <ShellIcon name="chevronRight" size={14} strokeWidth={2.6} />
      </button>

      {scrim && <div className="p-nav-scrim" aria-hidden="true" onClick={() => close('outside')} />}

      {/* data-p-nav — всплывашки из src/ui/kit (Popover, Menu) держатся правее видимой шторки (kit/position.js) */}
      <nav ref={panelRef} className="p-nav" data-p-nav="" aria-label="Главное меню" inert={!shown} onKeyDown={onPanelKey}>
        <div className="p-nav__stag" style={{ '--i': 0 }}>
          <div className="p-nav__head">
            <NavBrand brand={brand} />
            {!pinned && (
              <button type="button" className="p-nav__hide" onClick={hide}
                title="Скрыть меню · Esc" aria-label="Скрыть меню">
                <ShellIcon name="chevronLeft" size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>
          {onSearch && (
            <button type="button" className="p-nav__search" onClick={onSearch}>
              <ShellIcon name="search" size={16} />
              <span>Поиск по CRM</span>
              <kbd>{NAV_MOD_KEY} K</kbd>
            </button>
          )}
        </div>

        <div ref={listRef} className="p-nav__list" onPointerOver={onListOver} onPointerLeave={onListLeave}>
          <span ref={pillRef} className="p-nav__pill" aria-hidden="true" style={{ '--i': activeRow?.i ?? 1 }} />
          <span ref={hoverRef} className="p-nav__hover" aria-hidden="true" />
          {rows.map((r) => {
            if (r.type === 'sep') return <div key={r.id} className="p-nav__sep p-nav__stag" style={{ '--i': r.i }} role="separator" />;
            if (r.type === 'label') { // подпись группы — просто мелкий текст, без цветной точки
              return (
                <div key={r.id} className="p-nav__label p-nav__stag" style={{ '--i': r.i }}>
                  <span className="p-nav__label-t">{r.title}</span>
                </div>
              );
            }
            const it = r.item;
            const active = it.key === activeKey;
            const b = badgeOf(badges?.[it.key] ?? it.badge); // it.badge — как у старого Sidebar
            return (
              <button key={r.id} type="button" className="p-nav__item p-nav__stag" style={{ '--i': r.i }}
                data-nav-item="" data-nav-key={it.key} data-active={active ? '' : undefined}
                aria-current={active ? 'page' : undefined} onClick={(e) => select(it.key, e)}>
                <ShellIcon name={it.icon} fallback={it.iconFallback} size={18} />
                <span className="p-nav__item-label">{it.label}</span>
                {b && <span key={b.text} className="p-nav__badge" data-tone={b.tone}>{b.text}</span>}
              </button>
            );
          })}
        </div>

        <div className="p-nav__foot p-nav__stag" style={{ '--i': lastIndex }}>
          <div className="p-nav__me">
            <Avatar name={name} size={36} title={`${name} · ${role}`} />
            <span className="p-nav__me-txt">
              <b>{name}</b>
              <span>{role}{user?.demo && <em className="p-nav__demo">демо</em>}</span>
            </span>
            {footerSlot && <span className="p-nav__slot">{footerSlot}</span>}
            {onLogout && (
              <button type="button" className="p-nav__ibtn" onClick={onLogout} title="Выйти" aria-label="Выйти">
                <ShellIcon name="logout" size={16} />
              </button>
            )}
          </div>
          {wide && ( /* на узком экране закрепить нельзя — меню там всегда выезжает поверх */
            <button type="button" className="p-nav__pin" role="switch" aria-checked={pinned}
              title={`Закрепить меню · ${NAV_MOD_KEY} Shift \\`} onClick={() => setPinned(!pinned)}>
              <ShellIcon name="pin" size={17} />
              <span>Закрепить меню</span>
              <span className="p-nav__toggle" aria-hidden="true" />
            </button>
          )}
        </div>
      </nav>

      {coach && !shown && !pinned && canHover && (
        <div className="p-nav-coach" role="note">
          <b>Меню спрятано у левого края</b>
          <span>Подведите мышь к краю или нажмите <kbd>{NAV_MOD_KEY}</kbd> <kbd>\</kbd></span>
          <button type="button" className="p-nav-coach__x" aria-label="Понятно" title="Понятно" onClick={dismissCoach}>
            <ShellIcon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
