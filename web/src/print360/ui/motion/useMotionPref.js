// Print 360 — режим анимаций: 'full' | 'calm' | 'off'.
// Источник — <html data-motion> (ставит useTheme.js из app_settings.appearance.motion) и системное «уменьшить движение».
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function getMotionPref() {
  if (typeof document === 'undefined') return 'full';
  const attr = document.documentElement.getAttribute('data-motion');
  if (attr === 'off') return 'off';
  if (typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches) return 'off';
  return attr === 'calm' ? 'calm' : 'full';
}

function subscribe(cb) {
  if (typeof document === 'undefined') return () => {};
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(cb) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener?.('change', cb);
  return () => { mo?.disconnect(); mq?.removeEventListener?.('change', cb); };
}

/** Текущий режим анимаций; перерисовывает компонент, когда владелец его меняет */
export function useMotionPref() {
  return useSyncExternalStore(subscribe, getMotionPref, () => 'full');
}

/** Можно ли праздновать (конфетти): режим «Полные» и не выключено в настройках */
export function canCelebrate() {
  if (typeof document === 'undefined') return false;
  return getMotionPref() === 'full' && document.documentElement.getAttribute('data-celebrate') !== 'off';
}
