// Print 360 — живая цифра: при появлении на экране «прокручивается» с нуля до значения (одометр),
// при обновлении — прокручивается от старого к новому. ru-RU, цифры одной ширины, валюта ₽ мелким.
// Основа — @number-flow/react (портировано вместо Magic UI «Number Ticker» и React Bits «Count Up»);
// если браузер не умеет — откат на useCountUp; режим «Без анимаций» и plain — просто текст.
//   <Num value={84300} format="money" />                    → 84 300 ₽ (₽ мелким)
//   <Num value={40} format="pct" />                         → 40%
//   <Num value={24300} format="money" signed />             → +24 300 ₽
//   <Num value={1284000} compact />                         → 1,3 млн
//   <Num value={23} unit={['заказ', 'заказа', 'заказов']} /> → 23 заказа (подпись мелким, склонение по числу)
// Для PDF/печати (html2canvas не видит shadow DOM) — plain.
import NumberFlow, { useIsSupported } from '@number-flow/react';
import { useInView } from '../motion/useInView.js';
import { useCountUp } from '../motion/useCountUp.js';
import { useMotionPref } from '../motion/useMotionPref.js';
import { intlOptions, formatNumber, plural } from './numFormat.js';
import './fx.css';

const EASE = 'cubic-bezier(.22,1,.36,1)';

function Unit({ unit }) {
  if (unit == null || unit === false || unit === '') return null;
  return <small className="p-num__unit">{unit}</small>;
}

// Откат без NumberFlow: счёт с нуля через requestAnimationFrame
function CountText({ value, from, start, duration, format, decimals, compact, signed }) {
  const v = useCountUp(value, { from, start, duration });
  return formatNumber(v, { format, decimals, compact, signed });
}

export default function Num({
  value, format = 'int', decimals, compact = false, signed = false,
  unit, prefix, suffix, from = 0, countOnView = true, plain = false, duration = 900,
  className, style, title,
}) {
  const motion = useMotionPref();
  const supported = useIsSupported();
  const [ref, seen] = useInView({ once: true, disabled: !countOnView || plain });
  const n = Number(value);
  const finite = value != null && value !== '' && Number.isFinite(n);
  const unitText = unit === undefined ? (format === 'money' ? '₽' : null) : Array.isArray(unit) ? plural(n, unit) : unit;
  const suffixText = suffix === undefined ? (format === 'pct' ? '%' : '') : suffix;
  const cls = ['p-num', className].filter(Boolean).join(' ');

  if (!finite) {
    return <span className={cls} style={style} title={title}>—</span>;
  }
  const animated = !plain && motion !== 'off';
  if (!animated) {
    return (
      <span className={cls} style={style} title={title}>
        {prefix}{formatNumber(n, { format, decimals, compact, signed })}{suffixText}<Unit unit={unitText} />
      </span>
    );
  }
  const shown = countOnView && !seen ? from : n;

  if (!supported) {
    return (
      <span ref={ref} className={cls} style={style} title={title}>
        {prefix}<CountText value={n} from={from} start={!countOnView || seen} duration={duration} format={format}
          decimals={decimals} compact={compact} signed={signed} />{suffixText}<Unit unit={unitText} />
      </span>
    );
  }
  return (
    <span ref={ref} className={cls} style={style} title={title}>
      <NumberFlow
        className="p-num__flow"
        value={shown}
        locales="ru-RU"
        format={intlOptions(format, { decimals, compact, signed })}
        prefix={prefix || undefined}
        suffix={suffixText || undefined}
        animated
        respectMotionPreference
        willChange={false}
        transformTiming={{ duration, easing: EASE }}
        spinTiming={{ duration, easing: EASE }}
        opacityTiming={{ duration: 350, easing: 'ease-out' }}
      />
      <Unit unit={unitText} />
    </span>
  );
}
