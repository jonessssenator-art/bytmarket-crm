// Print 360 — панель по токенам темы (макет v2, .p2-card): в «Светлой» — белая карточка, в «Авроре» — матовое стекло
// с размытием и светлым кантом по углам. variant: 'panel' (по умолчанию) | 'sub' (подложка внутри панели) | 'chrome' (полоса на фоне).
//   <GlassPanel pad={20}>…</GlassPanel>        <GlassPanel as="section" variant="sub" pad={12}>…</GlassPanel>
import './fx.css';

export default function GlassPanel({ as = 'section', variant = 'panel', pad = 20, radius, onClick, className, style, children, ...rest }) {
  const Tag = as;
  const cls = ['p-glass', variant !== 'panel' && `p-glass--${variant}`, onClick && 'is-click', className].filter(Boolean).join(' ');
  return (
    <Tag className={cls} onClick={onClick}
      style={{ ...(pad != null ? { padding: typeof pad === 'number' ? `${pad}px` : pad } : null), ...(radius != null ? { borderRadius: radius } : null), ...style }}
      {...rest}>
      {children}
    </Tag>
  );
}
