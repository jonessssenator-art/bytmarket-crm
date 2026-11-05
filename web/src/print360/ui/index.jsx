// Print 360 — компоненты интерфейса. Из этих кирпичиков собирается каждый экран.
// Правила: цвета — только токены темы (var(--p-…), см. theme/tokens.css), иконки — только <Icon name=…/>, окна — только <Modal>.
// Эффекты и анимации — src/ui/fx и src/ui/motion, графики — src/ui/charts, тема — src/ui/theme.
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
// Токены, roleLabel, initials — в tokens.js; словарь иконок — iconSet.jsx (здесь только компоненты).
import { Icon } from './icons.jsx';
import { STAGE_TONE_V, initials } from './tokens.js';
import { EMOJI_ICON, emojiBase } from './emojiMap.js';
import './ui.css';

export { Icon } from './icons.jsx';
export { default as Wordmark } from './Wordmark.jsx';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* Кнопка: variant = primary (главное действие, акцент) | dark | soft | white (= secondary) | ghost | danger; size = sm | md | lg */
export function Button({ variant = 'primary', size = 'md', icon, iconRight, block, className, children, type = 'button', ...rest }) {
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;
  return (
    <button type={type} className={cx('ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, block && 'ui-btn--block', className)} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}

/* Круглая кнопка-иконка (иконка строго по центру). title обязателен — это подсказка и подпись для экранного диктора */
export function IconButton({ icon, title, variant = 'soft', size = 'md', className, ...rest }) {
  return (
    <button type="button" title={title} aria-label={title}
      className={cx('ui-btn', `ui-btn--${variant}`, 'ui-btn--icon', size !== 'md' && `ui-btn--${size}`, className)} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 14 : size === 'lg' ? 20 : 18} />
    </button>
  );
}

export function Label({ htmlFor, children }) {
  return <label className="ui-label" htmlFor={htmlFor}>{children}</label>;
}

/* Поле ввода в «таблетке». label — подпись сверху, icon — иконка слева */
export function Input({ label, icon, size = 'md', id, style, className, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <div style={style} className={className}>
      {label && <Label htmlFor={fieldId}>{label}</Label>}
      <div className={cx('ui-field', size === 'sm' && 'ui-field--sm')}>
        {icon && <Icon name={icon} size={16} />}
        <input id={fieldId} {...rest} />
      </div>
    </div>
  );
}

/* Выпадающий список: options = [{ value, label }] или массив строк */
export function Select({ label, icon, options = [], size = 'md', id, style, className, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <div style={style} className={className}>
      {label && <Label htmlFor={fieldId}>{label}</Label>}
      <div className={cx('ui-field', size === 'sm' && 'ui-field--sm')}>
        {icon && <Icon name={icon} size={16} />}
        <select id={fieldId} {...rest}>
          {options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o;
            return <option key={opt.value} value={opt.value}>{opt.label}</option>;
          })}
        </select>
        <Icon name="chevronDown" size={14} style={{ pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

export function Textarea({ label, id, style, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <div style={style}>
      {label && <Label htmlFor={fieldId}>{label}</Label>}
      <textarea id={fieldId} className="ui-textarea" {...rest} />
    </div>
  );
}

/* Переключатель вкладок с «бегущей таблеткой»: выбранная подложка переезжает к нажатой кнопке (пружина 380 мс).
   options = [{ value, label, icon?, count?, title? }]; tone = default | white | field (внутри панели) | dark (на тёмной плашке);
   size = md | sm. Плюс className, style, ariaLabel. */
export function Segmented({ options, value, onChange, tone = 'default', size = 'md', style, className, ariaLabel }) {
  const boxRef = useRef(null);
  const pillRef = useRef(null);
  const idx = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const box = boxRef.current, pill = pillRef.current;
    if (!box || !pill) return undefined;
    const place = (instant) => {
      const btn = box.children[idx + 1]; // [0] — сама таблетка
      if (idx < 0 || !btn) { box.removeAttribute('data-pill'); return; }
      if (instant) pill.style.transition = 'none';
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      box.setAttribute('data-pill', 'on');
      if (instant) {
        void pill.offsetWidth; // зафиксировать место без анимации
        pill.style.transition = '';
      }
    };
    place(box.getAttribute('data-pill') !== 'on');
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => place(true));
    ro.observe(box);
    return () => ro.disconnect();
  }, [idx, options.length]);

  return (
    <div ref={boxRef} className={cx('ui-seg', tone !== 'default' && `ui-seg--${tone}`, size === 'sm' && 'ui-seg--sm', className)}
      role="tablist" aria-label={ariaLabel} style={style}>
      <span ref={pillRef} className="ui-seg__pill" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} title={o.title}
          className={o.value === value ? 'on' : undefined} onClick={() => onChange?.(o.value)}>
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
          {o.count != null && <span className="ui-seg__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* Плашка: tone = neutral | ok | bad | warn | info | violet | gold (= accent) | deep | solid | outline; size = md | sm.
   Цветной точки нет (правка Раби 13.10.2026): проп dot ничего не рисует, цвет несут текст и подложка. */
export function Chip({ tone = 'neutral', icon, size = 'md', children, style, title, className }) {
  return (
    <span className={cx('ui-chip', `ui-chip--${tone}`, size === 'sm' && 'ui-chip--sm', className)} style={style} title={title}>
      {icon && <Icon name={icon} size={size === 'sm' ? 11 : 12} strokeWidth={2.2} />}
      <span className="ui-chip__t">{children}</span>
    </span>
  );
}

/* Плашка этапа сделки — цвет из STAGE_TONE_V (на переменных темы): цветной текст на мягкой подложке, без точки */
export function StageChip({ stage, style, size = 'md' }) {
  const t = STAGE_TONE_V[stage] || STAGE_TONE_V['Лид'];
  return (
    <span className={cx('ui-chip', size === 'sm' && 'ui-chip--sm')} style={{ background: t.bg, color: t.color, ...style }}>
      <span className="ui-chip__t">{stage}</span>
    </span>
  );
}

/* Карточка-панель. dark — тёмная акцентная плашка (внутри неё var(--p-ink) и др. становятся «светлыми на тёмном») */
export function Card({ title, dark, pad, style, className, children }) {
  return (
    <div className={cx('ui-card', dark && 'ui-card--dark p-plate', className)} style={{ ...(pad != null ? { padding: pad } : null), ...style }}>
      {title && <div className="ui-card__title">{title}</div>}
      {children}
    </div>
  );
}

// 6 цветов аватарок — переменные темы (--p-ava-1…6): в новых темах — градиенты, в «Классике» — прежние сплошные
const AVA_COUNT = 6;
const avaIndex = (name = '') => [...String(name)].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVA_COUNT;

/* Аватарка с инициалами. color — свой фон (перекрывает палитру); ring — цвет кольца (например var(--p-violet) у дизайнера) */
export function Avatar({ name, size = 36, color, ring, title, style }) {
  return (
    <span className="ui-ava" title={title ?? name}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)), background: color || `var(--p-ava-${avaIndex(name) + 1})`,
        boxShadow: ring ? `0 0 0 2px var(--p-ava-ring), 0 0 0 4px ${ring}` : undefined, ...style }}>
      {initials(name) || <Icon name="user" size={Math.round(size * 0.45)} />}
    </span>
  );
}

export function Toggle({ checked, onChange, title, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} title={title} aria-label={title} disabled={disabled}
      className={cx('ui-toggle', checked && 'on')} onClick={() => onChange?.(!checked)} />
  );
}

export function Checkbox({ checked, onChange, label, disabled }) {
  return (
    <label className={cx('ui-check', checked && 'on')} style={disabled ? { opacity: .5, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      <span className="ui-check__box">{checked && <Icon name="check" size={13} strokeWidth={3} />}</span>
      {label}
    </label>
  );
}

/* Окно — одно на все случаи. Закрывается крестиком, по Esc и кликом по затемнению (closeOnOverlay).
   footer — кнопки внизу; danger-кнопку кладите первой, перед <Spacer/>. Слой — var(--p-z-modal). */
export function Modal({ open = true, onClose, title, subtitle, width = 560, footer, closeOnOverlay = true, children, bodyStyle }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ui-overlay" onMouseDown={(e) => { if (closeOnOverlay && e.target === e.currentTarget) onClose?.(); }}>
      <div className="ui-modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        {(title || onClose) && (
          <div className="ui-modal__head">
            <div style={{ minWidth: 0 }}>
              {subtitle && <div className="ui-modal__sub">{subtitle}</div>}
              {title && <h3 className="ui-modal__title">{title}</h3>}
            </div>
            {onClose && <IconButton icon="close" title="Закрыть" className="ui-modal__close" onClick={onClose} />}
          </div>
        )}
        <div className="ui-modal__body" style={bodyStyle}>{children}</div>
        {footer && <div className="ui-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Spacer = () => <span className="ui-spacer" />;

/* Иконка внутри строки текста (заменила эмодзи): масштабируется по шрифту, стоит по средней линии.
   solo — иконка без текста рядом (без отступа справа); color — цвет-смысл (например var(--p-bad)) */
export function Ic({ n, solo, color, fill }) {
  return (
    <Icon name={n} size="1.1em" strokeWidth={2}
      style={{ verticalAlign: '-0.18em', marginRight: solo ? 0 : '0.32em', color, fill: fill ? 'currentColor' : undefined }} />
  );
}

/* Эмодзи из данных → линейная иконка, если она есть в словаре; иначе показываем как было.
   Пример: <Em e={category.icon} /> вместо {category.icon}. Строку «🗑 Удалить» разбирает на иконку + текст. */
export function Em({ e, solo = true }) {
  if (e == null || e === '') return null;
  const s = String(e);
  const m = s.match(/^(\S+?)\s+(.+)$/u);
  const head = emojiBase(m ? m[1] : s);
  const spec = EMOJI_ICON[head];
  if (!spec) return s;
  const [n, color, fill] = spec;
  return m ? <><Ic n={n} color={color || undefined} fill={!!fill} />{m[2]}</> : <Ic n={n} color={color || undefined} fill={!!fill} solo={solo} />;
}
