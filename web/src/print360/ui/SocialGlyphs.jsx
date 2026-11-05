// Print 360 — значки соцсетей в стиле lucide (линия 1.8, скругления): ВКонтакте, Telegram, WhatsApp.
// Брендов в наборе lucide нет, поэтому свои. Instagram не используем (юр. риск, решение 13.10.2026).
// В коде — через словарь: <Icon name="vk" />, <Icon name="telegram" />, <Icon name="whatsapp" />.
function GlyphSvg({ size = 18, strokeWidth = 1.8, color = 'currentColor', children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" {...rest}>{children}</svg>
  );
}
export function TelegramGlyph(props) {
  return (
    <GlyphSvg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M16.9 7.5 6.4 11.6c-.6.2-.6 1 0 1.2l2.6.9 1 3.2c.2.4.7.5 1 .2l1.5-1.4 2.7 2c.4.3 1 .1 1.1-.4l1.6-8.9c.1-.6-.5-1.1-1.1-.9z" />
      <path d="m9.6 13.9 4.9-3.5" />
    </GlyphSvg>
  );
}
export function WhatsappGlyph(props) {
  return (
    <GlyphSvg {...props}>
      <path d="M3.4 20.6 4.7 16.5A8.6 8.6 0 1 1 7.6 19.4z" />
      <path d="M9.1 8.4c.3-.4.6-.5 1-.5h.4c.3 0 .5.2.6.5l.6 1.5c.1.3 0 .6-.2.8l-.6.6c.6 1.2 1.6 2.2 2.8 2.8l.6-.6c.2-.2.5-.3.8-.2l1.5.6c.3.1.5.3.5.6v.4c0 .4-.2.7-.5 1-.7.5-1.6.6-2.5.3-2.2-.9-3.9-2.6-4.8-4.8-.3-.9-.2-1.8.3-2.5z" />
    </GlyphSvg>
  );
}
export function VkGlyph(props) {
  return (
    <GlyphSvg {...props}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="6" />
      <path d="M6.6 8.6c.3 4.5 2.6 7.1 6.3 7.1h.4v-2.7c1.3.1 2.3 1.1 2.7 2.7h1.9c-.5-2-1.8-3.1-2.6-3.5.8-.5 1.9-1.6 2.2-3.6h-1.8c-.4 1.5-1.5 2.6-2.5 2.7V8.6h-1.8v5c-1.1-.3-2.5-1.6-2.6-5z" />
    </GlyphSvg>
  );
}
