// Print 360 — иконки оболочки. Основной словарь — src/ui/iconSet.jsx (единый набор lucide);
// здесь только запасные имена, которых в нём пока нет (дашборд, база знаний, булавка…).
// В пункт меню можно передать имя иконки или сам компонент lucide.
import {
  LayoutDashboard, LibraryBig, Banknote, Pin, PinOff, Menu, PanelLeftOpen, Info, Play, LogIn, ArrowRight,
  ArrowLeftRight, X, Check, CircleCheck, CircleX, TriangleAlert, ScanEye, RotateCcw, Megaphone, Calculator,
  SlidersHorizontal, MessageCircle, Search, LogOut, Mail, KeyRound, Users, Eye, Sparkles, ChevronRight,
} from 'lucide-react';
import { ICONS } from '../ui/iconSet.jsx';

const LOCAL = {
  dashboard: LayoutDashboard, home: LayoutDashboard, kb: LibraryBig, knowledge: LibraryBig, library: LibraryBig,
  salary: Banknote, pin: Pin, unpin: PinOff, menu: Menu, panelOpen: PanelLeftOpen, info: Info, play: Play,
  login: LogIn, arrowRight: ArrowRight, swap: ArrowLeftRight, close: X, check: Check, ok: CircleCheck, fail: CircleX,
  alert: TriangleAlert, lookAs: ScanEye, reset: RotateCcw, promo: Megaphone, calc: Calculator, admin: SlidersHorizontal,
  chats: MessageCircle, search: Search, logout: LogOut, mail: Mail, key: KeyRound, users: Users, eye: Eye,
  magic: Sparkles, chevronRight: ChevronRight,
};

// fallback — запасное имя (iconFallback из navConfig), если основной иконки в наборе пока нет
export default function ShellIcon({ name, fallback, size = 18, strokeWidth = 1.9, className, style }) {
  const main = typeof name === 'string' ? ICONS[name] || LOCAL[name] : name;
  const Cmp = main || (typeof fallback === 'string' ? ICONS[fallback] || LOCAL[fallback] : fallback);
  if (!Cmp) return null;
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} style={{ flexShrink: 0, display: 'block', ...style }} aria-hidden="true" />;
}
