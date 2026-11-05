// Print 360 — светящаяся плитка-«сквиркл» для главных цифр (макет print360-v2-variants.html, .p2-tile).
// Идея — референс Раби, React Bits «Glass Icons», Magic UI «Neon Gradient Card»; переписано на чистый CSS (fx.css).
// Смысл цвета закреплён: lime — пришли деньги / рост; ember — горит, долг, просрочка; sky — производство; violet — дизайн, план.
//
//   <GlowTile tone="lime" title="Пришло сегодня" value={84300} format="money" icon="income"
//     chips={[{ label: '↑ 12% к вчера', tone: 'up' }, { label: '7 оплат' }]} onClick={…} />
//   <GlowTile tone="sky" title="В производстве" value={23} unit={['заказ', 'заказа', 'заказов']} chips={[{ icon: 'flame', label: '4 срочных' }]}
//     aside={<GlowStages items={[{ label: 'Очередь', value: 9 }, …]} />} />
//   <GlowTile tone="violet" title="Выручка за октябрь" value={1284000} format="money"
//     chips={[{ label: '↑ 8,4% к сентябрю', tone: 'up' }]}><GlowSpark caption="по дням" values={[…]} /></GlowTile>
import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import Num from './Num.jsx';
import { plural } from './numFormat.js';
import './fx.css';

const TONES = ['lime', 'ember', 'sky', 'violet'];
const cx = (...p) => p.filter(Boolean).join(' ');

const chipOf = (chip) => (typeof chip === 'string' ? { label: chip } : chip || {});

function Chip({ chip, more = false }) {
  const c = chipOf(chip);
  const tone = c.tone || (/^\s*↑/.test(String(c.label)) ? 'up' : /^\s*↓/.test(String(c.label)) ? 'down' : null);
  return (
    <span className={cx('p-glow__chip', tone && `p-glow__chip--${tone}`, more && 'p-glow__chip--more')} title={c.title || (typeof c.label === 'string' ? c.label : undefined)}>
      {c.icon && <Icon name={c.icon} size={13} strokeWidth={2.2} />}
      <span className="p-glow__chip-t">{c.label}</span>
    </span>
  );
}

// Чипы в одну строку и всегда целиком (правка Раби 13.10.2026: «3 сде…», «1 долг старше 14 …» — так нельзя).
// Невидимый ряд меряет все чипы; что не помещается целиком — уходит в чип «ещё N» (в подсказке — их названия).
// Первый чип виден всегда; сжимается с многоточием, только если не влезает даже один.
function GlowChips({ chips }) {
  const list = (chips || []).map(chipOf);
  const rowRef = useRef(null);
  const measRef = useRef(null);
  const [fit, setFit] = useState(null); // null — помещаются все; число — сколько показать до «ещё N»
  const sig = list.map((c) => `${typeof c.label === 'string' || typeof c.label === 'number' ? c.label : '*'}\u0001${c.icon || ''}\u0001${c.tone || ''}`).join('\u0002');

  useLayoutEffect(() => {
    const row = rowRef.current;
    const meas = measRef.current;
    if (!row || !meas) return undefined;
    const compute = () => {
      const avail = row.clientWidth;
      if (!avail) return;
      const kids = [...meas.children];
      const more = kids.pop();
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const widths = kids.map((k) => k.getBoundingClientRect().width);
      const total = widths.reduce((sum, w, i) => sum + w + (i ? gap : 0), 0);
      if (total <= avail + 0.5) { setFit(null); return; }
      const moreW = (more ? more.getBoundingClientRect().width : 56) + gap;
      let used = 0;
      let n = 0;
      for (let i = 0; i < widths.length; i += 1) {
        const w = widths[i] + (i ? gap : 0);
        if (used + w + moreW > avail + 0.5) break;
        used += w;
        n += 1;
      }
      setFit(Math.max(1, n));
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(compute);
    ro.observe(row);
    ro.observe(meas);
    return () => ro.disconnect();
  }, [sig]);

  if (!list.length) return <span className="p-glow__chips" />;
  const shown = fit == null ? list : list.slice(0, fit);
  const hidden = fit == null ? [] : list.slice(fit);
  const hiddenTitle = hidden.map((c) => (typeof c.label === 'string' || typeof c.label === 'number' ? String(c.label) : c.title || '')).filter(Boolean).join(' · ');
  return (
    <span ref={rowRef} className="p-glow__chips">
      {shown.map((c, k) => <Chip key={k} chip={c} />)}
      {hidden.length > 0 && <Chip chip={{ label: `ещё ${hidden.length}`, title: hiddenTitle || undefined }} more />}
      <span ref={measRef} className="p-glow__chips-measure" aria-hidden="true">
        {list.map((c, k) => <Chip key={k} chip={c} />)}
        <Chip chip={{ label: `ещё ${list.length}` }} more />
      </span>
    </span>
  );
}

export default function GlowTile({
  tone = 'lime', title, value, format, unit, decimals, prefix, signed, compact, caption,
  chips, icon, iconTitle, children, aside, onClick, hot = false, loading = false,
  size = 'md', reveal = true, i = 0, className, style, as, ariaLabel,
}) {
  const t = TONES.includes(tone) ? tone : 'lime';
  const Tag = as || (onClick ? 'button' : 'article');
  const clickable = typeof onClick === 'function';
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
  const fmt = format || (unit === '₽' ? 'money' : 'int');

  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      className={cx('p-glow', `p-glow--${t}`, size === 'sm' && 'p-glow--sm', size === 'auto' && 'p-glow--auto', clickable && 'is-click', reveal && 'p-rise', className)}
      style={{ '--i': i, ...style }}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
    >
      <span className="p-glow__fx" aria-hidden="true"><i className="p-glow__sheen p-loop" /></span>
      <span className="p-glow__rim p-loop" aria-hidden="true" />
      {hot && <span className="p-glow__halo p-loop" aria-hidden="true" />}
      <span className="p-glow__body">
        <span className="p-glow__main">
          <span className="p-glow__top">
            <span className="p-glow__title">{title}</span>
            {icon && <span className="p-glow__ic" title={iconTitle}><Icon name={icon} size={16} strokeWidth={2.1} /></span>}
          </span>
          {loading ? (
            <><span className="p-glow__skel p-shimmer" /><span className="p-glow__skel p-glow__skel--sm p-shimmer" /></>
          ) : (
            <>
              <span className="p-glow__num">
                {numeric
                  ? <Num value={Number(value)} format={fmt} unit={fmt === 'money' && unit === undefined ? '₽' : unit ?? null}
                      decimals={decimals} prefix={prefix} signed={signed} compact={compact} />
                  : <>{value}{unit != null && unit !== false && <small className="p-glow__unit">{Array.isArray(unit) ? plural(Number(String(value).replace(/\D/g, '')), unit) : unit}</small>}</>}
              </span>
              {caption && <span className="p-glow__cap">{caption}</span>}
              {(chips?.length > 0 || children) && (
                <span className="p-glow__foot">
                  <GlowChips chips={chips} />
                  {children && <span className="p-glow__extra">{children}</span>}
                </span>
              )}
            </>
          )}
        </span>
        {aside && !loading && <span className="p-glow__aside">{aside}</span>}
      </span>
    </Tag>
  );
}

/** Мини-столбики по дням внутри плитки (последний — «сегодня», светится). values — числа; labels — подсказки к столбикам */
export function GlowSpark({ values = [], labels, caption, max, nowIndex }) {
  const top = max ?? Math.max(1, ...values.map((v) => Number(v) || 0));
  const now = nowIndex ?? values.length - 1;
  return (
    <span className="p-glow-spark" role="img" aria-label={caption ? `${caption}: ${values.join(', ')}` : undefined}>
      {caption && <span className="p-glow-spark__cap">{caption}</span>}
      <span className="p-glow-spark__bars">
        {values.map((v, k) => (
          <i key={k} className={k === now ? 'is-now' : undefined} title={labels?.[k]}
            style={{ height: `${Math.max(8, ((Number(v) || 0) / top) * 100)}%`, '--i': k }} />
        ))}
      </span>
    </span>
  );
}

/** Колонки этапов справа во всю высоту плитки: items = [{ label, value }] — у каждой цифры подпись */
export function GlowStages({ items = [], height = 66, ariaLabel }) {
  const top = Math.max(1, ...items.map((s) => Number(s.value) || 0));
  return (
    <span className="p-glow-stages" role="img" aria-label={ariaLabel || items.map((s) => `${s.label} ${s.value}`).join(', ')}>
      {items.map((s, k) => (
        <span className="p-glow-stages__col" key={s.label ?? k}>
          <b>{s.value}</b>
          <i style={{ height: Math.max(10, ((Number(s.value) || 0) / top) * height), '--i': k }} />
          <span>{s.label}</span>
        </span>
      ))}
    </span>
  );
}
