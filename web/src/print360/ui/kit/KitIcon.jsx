// Набор элементов Print 360 — иконка внутри набора.
// name: строка из словаря набора (стрелки, сортировка…), иначе — из общего словаря src/ui/iconSet.jsx (<Icon name>);
// можно передать и сам компонент lucide или готовый элемент.
import { isValidElement } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ChevronsLeftRight, ArrowUp, ArrowDown, ArrowUpDown,
  Check, X, Clock, Search, Copy, CopyCheck, Upload, FileText, Image, Trash2, Ellipsis, Plus, CalendarDays,
  CircleHelp, GripVertical, CircleAlert, Inbox, Flame, Minus, CornerDownLeft, Paperclip, CloudUpload, FoldHorizontal,
} from 'lucide-react';
import { Icon } from '../index.jsx';

const KIT_ICONS = {
  chevronLeft: ChevronLeft, chevronRight: ChevronRight, chevronDown: ChevronDown, chevronUp: ChevronUp,
  chevronsLR: ChevronsLeftRight, fold: FoldHorizontal, arrowUp: ArrowUp, arrowDown: ArrowDown, sort: ArrowUpDown,
  check: Check, close: X, clock: Clock, search: Search, copy: Copy, copied: CopyCheck, upload: Upload,
  file: FileText, image: Image, trash: Trash2, more: Ellipsis, plus: Plus, calendar: CalendarDays,
  help: CircleHelp, grip: GripVertical, alert: CircleAlert, inbox: Inbox, flame: Flame, minus: Minus,
  enter: CornerDownLeft, attach: Paperclip, cloudUpload: CloudUpload,
};

export function KitIcon({ name, size = 16, strokeWidth = 1.9, className, style }) {
  if (!name) return null;
  if (isValidElement(name)) return name;
  if (typeof name !== 'string') {
    const Cmp = name;
    return <Cmp size={size} strokeWidth={strokeWidth} aria-hidden="true" className={className} style={{ flexShrink: 0, ...style }} />;
  }
  const Cmp = KIT_ICONS[name];
  if (Cmp) return <Cmp size={size} strokeWidth={strokeWidth} aria-hidden="true" className={className} style={{ flexShrink: 0, ...style }} />;
  return <Icon name={name} size={size} strokeWidth={strokeWidth} className={className} style={style} />;
}
