// Print 360 — знак в шапке раздела: открывает спрятанное меню (главный путь на планшете и для новичка).
// Тёмное стекло 40×40: буква «P» логотипа, при наведении — значок «открыть панель».
// badge — true (точка: «есть что-то горящее», раз в 6 с вспыхивает) или число; badgeLabel — подпись к нему словами
// («3 сделки горят»): у каждой цифры должна быть подпись. Меню закреплено — знак прячется.
// Открыть меню из любого места без знака: import { openNav } from './NavMark.jsx' (или из './navBus.js').
import { useSyncExternalStore } from 'react';
import { Wordmark } from '../ui/index.jsx';
import ShellIcon from './shellIcons.jsx';
import { getNavSnapshot, subscribeNav, toggleNav, NAV_MOD_KEY } from './navBus.js';
import './nav.css';

// eslint-disable-next-line react-refresh/only-export-components
export { openNav, closeNav, toggleNav, NAV_EVENTS } from './navBus.js';

export default function NavMark({ badge, badgeLabel, title, className, onClick }) {
  const nav = useSyncExternalStore(subscribeNav, getNavSnapshot, getNavSnapshot);
  const expanded = nav.state === 'open';
  const label = title || `Меню · ${NAV_MOD_KEY} \\`;
  const onTap = (e) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    const pt = e.nativeEvent?.pointerType;
    toggleNav({ by: pt === 'touch' || pt === 'pen' ? 'touch' : e.detail === 0 ? 'keyboard' : 'click' });
  };
  return (
    <button type="button" className={`p-navmark no-print${className ? ` ${className}` : ''}`}
      data-p-nav-keep="" data-pinned={nav.pinned ? '' : undefined}
      aria-label={badge && badgeLabel ? `Меню · ${badgeLabel}` : 'Меню'} aria-expanded={expanded}
      title={badge && badgeLabel ? `${label} · ${badgeLabel}` : label} onClick={onTap}>
      <span className="p-navmark__p" aria-hidden="true"><Wordmark mark height={18} color="currentColor" title="" /></span>
      <span className="p-navmark__ic" aria-hidden="true"><ShellIcon name="panelOpen" size={19} /></span>
      {badge ? <span className="p-navmark__badge">{badge === true ? '' : badge}</span> : null}
    </button>
  );
}
