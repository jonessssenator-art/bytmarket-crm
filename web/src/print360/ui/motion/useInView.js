// Print 360 — «элемент показался на экране». Возвращает [ref-колбэк, inView].
//   const [ref, seen] = useInView();        // once: true — один раз и навсегда
//   <div ref={ref}>{seen && <Chart/>}</div>
import { useEffect, useState } from 'react';

const HAS_IO = typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';

export function useInView({ once = true, rootMargin = '0px 0px -6% 0px', threshold = 0, disabled = false } = {}) {
  const [node, setNode] = useState(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (disabled || !node || !HAS_IO) return undefined;
    const io = new IntersectionObserver((entries) => {
      const hit = entries.some((e) => e.isIntersecting);
      if (hit) {
        setInView(true);
        if (once) io.disconnect();
      } else if (!once) {
        setInView(false);
      }
    }, { rootMargin, threshold });
    io.observe(node);
    return () => io.disconnect();
  }, [node, once, rootMargin, threshold, disabled]);

  // Без IntersectionObserver (старый браузер) — считаем, что видно сразу
  return [setNode, disabled || !HAS_IO ? true : inView];
}

export default useInView;
