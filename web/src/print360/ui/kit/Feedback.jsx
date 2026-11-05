// Набор элементов Print 360 — пустые состояния и загрузка.
// EmptyState: иконка в круге, заголовок, понятный текст «что сюда попадёт» и действие.
// Skeleton: бегущий блик вместо «пусто», пока данные грузятся (строки, карточки, квитанции, строки таблицы).
import { isValidElement } from 'react';
import { Button } from '../index.jsx';
import { KitIcon } from './KitIcon.jsx';
import './kit.css';

const cx = (...a) => a.filter(Boolean).join(' ');

/**
 * EmptyState
 * icon — имя иконки; tone — accent | ok | bad | warn | info | violet | neutral;
 * layout — row (иконка слева, как в макете) | center (по центру — для колонок, таблиц, окон);
 * action — узел или { label, onClick, icon, variant } (кнопка из src/ui).
 */
export function EmptyState({ icon = 'inbox', title, text, action, tone = 'accent', layout = 'row', size = 'md', className, children }) {
  let act = null;
  if (isValidElement(action)) act = action;
  else if (action && action.label) {
    act = <Button variant={action.variant || 'white'} size={size === 'sm' ? 'sm' : 'md'} icon={action.icon} onClick={action.onClick}>{action.label}</Button>;
  }
  return (
    <div className={cx('p-kit-empty', `p-kit-empty--${layout}`, size === 'sm' && 'p-kit-empty--sm', `is-${tone}`, className)}>
      <span className="p-kit-empty-ic" aria-hidden="true"><KitIcon name={icon} size={size === 'sm' ? 18 : 24} /></span>
      <div className="p-kit-empty-txt">
        {title && <b className="p-kit-empty-t">{title}</b>}
        {text && <p className="p-kit-empty-p">{text}</p>}
        {children}
      </div>
      {act && <div className="p-kit-empty-act">{act}</div>}
    </div>
  );
}

const bar = (w, h = 12, key, extra) => (
  <span key={key} className={cx('p-kit-skel', 'p-shimmer', extra)} style={{ width: w, height: h }} />
);

function SkelOne({ variant, lines, width, height, radius }) {
  switch (variant) {
    case 'line': return bar(width ?? '100%', height ?? 12);
    case 'block': return <span className="p-kit-skel p-shimmer" style={{ width: width ?? '100%', height: height ?? 80, borderRadius: radius }} />;
    case 'circle': return <span className="p-kit-skel p-shimmer" style={{ width: width ?? 36, height: width ?? 36, borderRadius: '50%' }} />;
    case 'card':
      return (
        <div className="p-kit-skel-card">
          {bar('46%', 14)}
          <div className="p-kit-skel-lines">{bar('100%')}{bar('88%')}{bar('62%')}</div>
        </div>
      );
    case 'receipt':
      return (
        <div className="p-kit-skel-rc">
          <div className="p-kit-skel-row">{bar(62, 20, 'a', 'is-pill')}{bar(52, 20, 'b', 'is-pill')}<span className="p-kit-skel-gap" />{bar(78, 12)}</div>
          {bar('74%', 14)}
          {bar('58%', 11)}
          <div className="p-kit-skel-perf" />
          <div className="p-kit-skel-row">{bar('52%', 10)}<span className="p-kit-skel-gap" /><span className="p-kit-skel p-shimmer" style={{ width: 26, height: 26, borderRadius: '50%' }} /></div>
        </div>
      );
    case 'row':
      return (
        <div className="p-kit-skel-tr">
          <span className="p-kit-skel p-shimmer" style={{ width: 30, height: 30, borderRadius: '50%' }} />
          <div className="p-kit-skel-lines">{bar('54%', 12)}{bar('36%', 10)}</div>
          {bar(72, 12)}
        </div>
      );
    default: {
      const ws = ['100%', '92%', '64%', '84%', '72%'];
      return <div className="p-kit-skel-lines">{Array.from({ length: lines }, (_, i) => bar(ws[i % ws.length], height ?? 12, i))}</div>;
    }
  }
}

/**
 * Skeleton — заглушка загрузки.
 * variant: lines (по умолчанию) | line | block | circle | card | receipt | row; count — сколько штук.
 */
export function Skeleton({ variant = 'lines', count = 1, lines = 3, width, height, radius, gap = 12, className, style, label = 'Загружаем…' }) {
  return (
    <div className={cx('p-kit-skel-wrap', className)} style={{ gap, ...style }} role="status" aria-live="polite">
      <span className="p-kit-sr">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <SkelOne key={i} variant={variant} lines={lines} width={width} height={height} radius={radius} />
      ))}
    </div>
  );
}
