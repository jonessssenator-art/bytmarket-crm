// Print 360 — дизайн-токены для JS.
// С 13.10.2026 цвета живут в CSS-переменных темы (src/ui/theme/tokens.css: «Светлая» / «Аврора» / «Классика» / «Бумага»).
//   V — те же ключи, что у C, но значения "var(--p-…)": НОВЫЙ КОД берёт только V (цвет меняется вместе с темой).
//   C — прежние hex «Классики»: только для старого кода и мест, где переменная невозможна (canvas, альфа-склейки).
// Утверждено по макетам print360-variants.html (06.10.2026) и print360-v2-variants.html (12.10.2026): шрифт Manrope, подписи обычными буквами.

export const C = {
  // бренд
  sb: '#3E5754',        // боковое меню, тёмные панели, «тёмная» кнопка
  sbDeep: '#344B48',    // нижняя часть тёмных панелей, профиль в меню
  sbText: '#EEF3F2',
  sbMuted: 'rgba(238,243,242,.62)',
  gold: '#D4A33B',      // главное действие и выделение — больше нигде
  goldHover: '#C2912C',
  goldSoft: '#F7EDD5',
  goldText: '#A87A1B',  // текст на goldSoft

  // нейтральные
  page: '#D5E3E1',
  canvas: '#E5ECEB',    // фон рабочей области
  field: '#E9EFEE',     // поля ввода, мягкие кнопки
  surface: '#FFFFFF',   // карточки
  ink: '#2E4644',       // основной текст
  ink2: '#536966',      // второстепенный текст
  muted: '#879895',     // подписи
  line: '#DCE5E3',      // разделители

  // смысловые — не заменяются акцентом
  ok: '#3D9A72', okSoft: '#E1F1E9',         // оплачено, готово
  bad: '#D05846', badSoft: '#F8E3DF',       // долг, ошибка, удаление
  warn: '#E0873A', warnSoft: '#FBEADB',     // внимание, срочно
  info: '#4C83A6', infoSoft: '#E1ECF3',     // инфо
  violet: '#8768AE', violetSoft: '#EEE8F5', // дизайн
  deep: '#2D6A55', deepSoft: '#DDEBE5',     // успешно сдан
};

// Те же ключи, что у C, — значения на переменных темы. Плюс новые токены макета v2.
const v = (name) => `var(--p-${name})`;
export const V = {
  // бренд (старые имена — алиасы в tokens.css)
  sb: v('sb'), sbDeep: v('sb-deep'), sbText: v('sb-text'), sbMuted: v('sb-muted'),
  gold: v('gold'), goldHover: v('gold-hover'), goldSoft: v('gold-soft'), goldText: v('gold-text'),
  // нейтральные
  page: v('page'), canvas: v('canvas'), field: v('field'), surface: v('surface'),
  ink: v('ink'), ink2: v('ink-2'), muted: v('muted'), line: v('line'),
  // смысловые
  ok: v('ok'), okSoft: v('ok-soft'), bad: v('bad'), badSoft: v('bad-soft'), warn: v('warn'), warnSoft: v('warn-soft'),
  info: v('info'), infoSoft: v('info-soft'), violet: v('violet'), violetSoft: v('violet-soft'), deep: v('deep'), deepSoft: v('deep-soft'),
  // новое (макет v2)
  scene: v('scene'), panel: v('panel'), sub: v('sub'), subHover: v('sub-hover'), chrome: v('chrome'), solid: v('solid'),
  faint: v('faint'), lineStrong: v('line-strong'), track: v('track'),
  accent: v('accent'), accentHover: v('accent-hover'), onAccent: v('on-accent'), accentInk: v('accent-ink'),
  accentSoft: v('accent-soft'), accentGlow: v('accent-glow'), accentGraphic: v('accent-graphic'), focus: v('focus'),
  plate: v('plate'), onPlate: v('on-plate'), onPlateMuted: v('on-plate-muted'),
  segOn: v('seg-on'), segOnInk: v('seg-on-ink'), tipBg: v('tip-bg'), tipInk: v('tip-ink'),
  up: v('up'), down: v('down'),
  chart: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`chart-${i}`)),
};

// 8 размеров текста: у каждого своя роль
export const FS = {
  cap: 11,   // подписи блоков
  xs: 12,    // кнопки, поля, меню
  sm: 13,    // основной текст и таблицы
  md: 14,    // суммы
  lg: 16,    // заголовок блока
  xl: 20,    // заголовок окна
  xxl: 24,   // заголовок раздела
  xxxl: 32,  // главная цифра
};

// 4 скругления
export const R = { sm: 8, md: 14, lg: 24, full: 999 };

// 3 тени
export const SH = {
  card: '0 1px 2px rgba(46,70,68,.07)',
  pop: '0 12px 32px rgba(46,70,68,.12)',
  modal: '0 32px 90px rgba(22,40,38,.35)',
};

export const FONT = "'Manrope', system-ui, sans-serif";

// Цвета 8 этапов сделки (плашки, точки на колонках канбана)
export const STAGE_TONE = {
  'Лид': { color: C.ink2, bg: C.field, dot: C.muted },
  'Консультация': { color: C.info, bg: C.infoSoft, dot: C.info },
  'Ожидание оплаты': { color: C.warn, bg: C.warnSoft, dot: C.warn },
  'Дизайн': { color: C.violet, bg: C.violetSoft, dot: C.violet },
  'Производство': { color: C.goldText, bg: C.goldSoft, dot: C.gold },
  'Заказ готов': { color: C.ok, bg: C.okSoft, dot: C.ok },
  'Успешно сдан': { color: C.deep, bg: C.deepSoft, dot: C.deep },
  'Провален': { color: C.bad, bg: C.badSoft, dot: C.bad },
};

// Те же этапы на переменных темы — для нового кода (StageChip уже на них).
// «Производство» — акцент (как в макете v2), «Успешно сдан» — спокойная плашка (--p-deep: в «Классике» тёмно-зелёная).
export const STAGE_TONE_V = {
  'Лид': { color: V.ink2, bg: V.field, dot: V.muted },
  'Консультация': { color: V.info, bg: V.infoSoft, dot: V.info },
  'Ожидание оплаты': { color: V.warn, bg: V.warnSoft, dot: V.warn },
  'Дизайн': { color: V.violet, bg: V.violetSoft, dot: V.violet },
  'Производство': { color: V.accentInk, bg: V.accentSoft, dot: V.accentGraphic },
  'Заказ готов': { color: V.ok, bg: V.okSoft, dot: V.ok },
  'Успешно сдан': { color: V.deep, bg: V.deepSoft, dot: V.deep },
  'Провален': { color: V.bad, bg: V.badSoft, dot: V.bad },
};

// Виды производства → цвет (--p-k-*) и мягкая подложка (--p-k-*-soft). Ключи новые (paper…) и старые (print_paper…).
const kind = (k) => ({ color: v(`k-${k}`), soft: v(`k-${k}-soft`) });
export const KIND_TONE = {
  paper: kind('paper'), film: kind('film'), tissue: kind('tissue'), ribbon: kind('ribbon'), wide: kind('wide'), other: kind('other'),
  print_paper: kind('paper'), print_film: kind('film'), print_tissue: kind('tissue'), print_lenta: kind('ribbon'),
  lenta: kind('ribbon'), wideformat: kind('wide'), reorder: kind('other'),
};
export const kindTone = (key) => KIND_TONE[key] || KIND_TONE.other;

// Роли Print 360. Внутренние имена в БД остаются прежними (на них завязана логика прав),
// показываем пользователю — новые. «Админ» в коде занят старым именем Владельца,
// поэтому куратор живёт под внутренним именем «Управляющий».
export const ROLE_LABEL = {
  'Владелец': 'Владелец',
  'Управляющий': 'Админ',
  'Менеджер': 'Менеджер',
  'Дизайнер': 'Дизайнер',
  'Печатник': 'Цех',
  'Постпечатник': 'Цех',
  'Маркетолог': 'Маркетолог',
  'СММ Менеджер': 'Маркетолог',
};
export const roleLabel = (role) => ROLE_LABEL[role] || role || '';

// Инициалы для аватарки: «Анна Смирнова» → «АС»
export const initials = (name = '') => String(name).trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
