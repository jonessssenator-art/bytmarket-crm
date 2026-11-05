// Print 360 — цвета групп меню и тоны бейджей. Только токены (var(--p-…)), без hex.
// Смысл цветов закреплён: лайм — деньги/рост/главное, угли — горит/долг, небо — цех/в работе, фиолет — дизайн/план.

const GLOW = ['lime', 'ember', 'sky', 'violet'];

// Цвет группы navConfig: сначала смысловой tone ('lime' | 'ember' | 'sky' | 'violet' | 'gold'), потом color (CSS).
// tone важнее: --p-gold в новых темах — алиас акцента, а группе «Ресурсы» нужен именно тёплый янтарь.
export function groupColorOf(group) {
  const tone = group?.tone;
  if (tone && (GLOW.includes(tone) || ['gold', 'amber', 'orange', 'accent'].includes(tone))) return groupColorVar(tone);
  return groupColorVar(group?.color || tone);
}

// Цвет группы из navConfig → CSS-значение. Принимает имя свечения ('lime' | 'ember' | 'sky' | 'violet'),
// 'accent', 'gold' (тёплый янтарь), имя токена ('--p-ok') или готовое CSS-значение (var(…), color-mix(…)).
export function groupColorVar(color) {
  if (!color) return 'var(--p-nav-muted)';
  const c = String(color).trim();
  if (GLOW.includes(c)) return `var(--p-rim-${c})`;
  if (c === 'accent') return 'var(--p-accent)';
  if (c === 'gold' || c === 'amber' || c === 'orange') return 'color-mix(in srgb, var(--p-rim-ember) 50%, var(--p-rim-lime))';
  if (c === 'muted' || c === 'neutral') return 'var(--p-nav-muted)';
  if (c.startsWith('--')) return `var(${c})`;
  return c; // var(…), color-mix(…) и т. п. — как есть
}

// Тон бейджа по тексту, если пришла просто строка: «3 горят» → hot, «+48,6 тыс сегодня» → up …
export function guessBadgeTone(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return 'neutral';
  if (s.startsWith('+')) return 'up';
  if (/гор[яи]т|просроч|долг|сгора/.test(s)) return 'hot';
  if (/заканчива|мало|ждут|ждёт/.test(s)) return 'warn';
  if (/в цеху|в работе|в печати/.test(s)) return 'info';
  return 'neutral';
}

// Бейдж пункта меню: строка, число или { text, tone } → { text, tone } | null
export function badgeOf(raw) {
  if (raw == null || raw === false || raw === '' || raw === 0) return null;
  if (typeof raw === 'number') return { text: String(raw), tone: 'neutral' };
  if (typeof raw === 'string') return { text: raw, tone: guessBadgeTone(raw) };
  if (typeof raw === 'object' && raw.text) return { text: String(raw.text), tone: raw.tone || guessBadgeTone(raw.text) };
  return null;
}
