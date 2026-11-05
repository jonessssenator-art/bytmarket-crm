// Print 360 — счёт цифры с нуля: 900 мс, мягкое торможение (ease-out), без анимации в режиме «Без анимаций».
//   const v = useCountUp(84300, { start: seen });   →  0 … 84300 за 900 мс
//   <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</b>
import { useEffect, useRef, useState } from 'react';
import { useMotionPref } from './useMotionPref.js';

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

export function useCountUp(target, { duration = 900, from = 0, start = true, decimals, easing = easeOutCubic } = {}) {
  const motion = useMotionPref();
  const to = Number.isFinite(Number(target)) ? Number(target) : 0;
  const [value, setValue] = useState(from);
  const current = useRef(from);
  const animate = motion !== 'off';

  useEffect(() => {
    if (!start || !animate) return undefined;
    const v0 = current.current;
    if (v0 === to) return undefined;
    const t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / Math.max(1, duration));
      const v = v0 + (to - v0) * easing(p);
      current.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, start, animate, duration, easing]);

  const out = !animate ? to : start ? value : from;
  if (decimals == null) return out;
  const k = 10 ** decimals;
  return Math.round(out * k) / k;
}

export default useCountUp;
