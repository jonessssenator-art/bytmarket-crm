// Print 360 — единый набор иконок (lucide). Одна толщина линии, один стиль.
// В коде пишем <Icon name="deals" />, а не эмодзи и не случайный SVG. Словарь имён — iconSet.jsx.
import { ICONS } from './iconSet.jsx';

export function Icon({ name, size = 18, strokeWidth = 1.8, style, ...rest }) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  return <Cmp size={size} strokeWidth={strokeWidth} style={{ flexShrink: 0, ...style }} aria-hidden="true" {...rest} />;
}
