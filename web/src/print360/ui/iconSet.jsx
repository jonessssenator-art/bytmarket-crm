// Print 360 — словарь иконок: имя → компонент lucide. Сам компонент — <Icon> в icons.jsx.
// Имена не удаляем (их зовёт старый код). Новые — внизу, по группам.
import {
  MessageCircle, SquareKanban, Palette, Printer, Users, SquareCheckBig, Wallet, Package, Calculator,
  ChartPie, Megaphone, FileChartColumn, SlidersHorizontal, Search, Plus, Bell, Calendar, Phone, X, Funnel,
  ChevronDown, FileText, ArrowDownLeft, ArrowUpRight, Clock, LogOut, Check, Zap, User, CreditCard, Banknote,
  Landmark, Download, Pencil, Trash2, TriangleAlert, ArrowLeftRight, Ellipsis, Send, Paperclip, Crown, Eye,
  BookOpen, Building2, ChevronsLeft, ChevronsRight, RotateCcw, Sparkles, MessageSquareText, Inbox, UserPlus,
  Shield, KeyRound, Upload, Handshake, Target,
  Lock, Unlock, ClipboardList, ChartColumn, RefreshCw, Ban, Briefcase, Link, Gift, Lightbulb, Factory, Save, Shirt,
  Scissors, Layers, Ruler, House, Film, PartyPopper, Tag, Pin, FolderOpen, Receipt, Repeat, TrendingUp, Wrench, MapPin,
  Puzzle, Flame, Bot, ShoppingBag, Car, Monitor, Gem, UtensilsCrossed, CircleHelp, Ribbon, Circle, Coins, StickyNote,
  Hourglass, Star, Truck, CircleCheck, CircleX, Undo2, Copy, ExternalLink, Timer, Archive, ArchiveRestore, Heart,
  ThumbsUp, Mail, Camera, Image,
  Stethoscope, Plane, Flower2, Mic, Scale, Signpost, Trophy, Globe, Cloud, Minus, Contact, Square, Newspaper, Flag,
  AppWindow, Magnet, Baby, Volleyball, ArrowUp, ArrowDown,
  // v2 (13.10.2026): новые разделы, оболочка, тема, графики, перетаскивание
  LayoutDashboard, LibraryBig, HandCoins, Rocket, GripVertical, Sparkle, QrCode, Folder, FileImage, PinOff,
  PanelLeft, PanelLeftOpen, PanelLeftClose, Sun, Moon, SunMoon, WandSparkles, TrendingDown, LayoutGrid, List,
  Kanban, CalendarDays, CalendarCheck, CalendarClock, CalendarRange, Play, Pause, History, ChevronRight, ChevronLeft,
  ChevronUp, ArrowRight, ArrowLeft, ArrowDownRight, EllipsisVertical, Menu, Settings, Gauge, Activity, Percent,
  RussianRuble, PiggyBank, ReceiptText, ClockAlert, AlarmClock, CheckCheck, CircleDot, Info, CircleAlert, BadgeCheck,
  Award, Medal, EyeOff, ListFilter, ArrowUpDown, Maximize2, Minimize2, Keyboard, Command, PackageCheck, PackageOpen,
  Boxes, Sticker, Images, CloudUpload, Stamp, SwatchBook, Pipette, Paintbrush, PenTool, Type, Shapes, ChartLine,
  ChartArea, ChartNoAxesColumn, Table2, Columns3, MousePointerClick, PhoneCall, MessageCircleMore, MessagesSquare,
  AtSign, Hash, Link2, Share2, Reply, LoaderCircle, Power, LogIn, UserCheck, UserCog, ShieldCheck, BellRing, BellOff,
  Siren, Smile, Store, Warehouse, ShoppingCart, Tags, CirclePlus, CircleMinus, Redo2, Shuffle, Route, Smartphone,
  ListChecks, ListTodo, Bookmark, Building, Layers2, ScanLine, Rows3, Laptop, CircleDollarSign, Lightbulb as Bulb,
} from 'lucide-react';

// соцсети: свои значки в стиле lucide (брендов в наборе lucide нет). Instagram не используем (юр. риск)
import { TelegramGlyph, WhatsappGlyph, VkGlyph } from './SocialGlyphs.jsx';

export const ICONS = {
  // разделы меню
  chats: MessageCircle, deals: SquareKanban, design: Palette, production: Printer, clients: Users,
  tasks: SquareCheckBig, finance: Wallet, warehouse: Package, calculator: Calculator, analytics: ChartPie,
  sales_plan: Target, marketing: Megaphone, reports: FileChartColumn, settings: SlidersHorizontal,
  // действия и объекты
  arrowUp: ArrowUp, arrowDown: ArrowDown,
  search: Search, plus: Plus, bell: Bell, calendar: Calendar, phone: Phone, close: X, filter: Funnel,
  chevronDown: ChevronDown, file: FileText, income: ArrowDownLeft, expense: ArrowUpRight, clock: Clock,
  logout: LogOut, check: Check, urgent: Zap, user: User, card: CreditCard, cash: Banknote, bank: Landmark,
  download: Download, edit: Pencil, trash: Trash2, alert: TriangleAlert, transfer: ArrowLeftRight,
  more: Ellipsis, send: Send, attach: Paperclip, owner: Crown, eye: Eye, book: BookOpen, building: Building2,
  collapse: ChevronsLeft, expand: ChevronsRight, reset: RotateCcw, magic: Sparkles, message: MessageSquareText,
  inbox: Inbox, userPlus: UserPlus, shield: Shield, key: KeyRound, upload: Upload, partners: Handshake,
  // Instagram убран (юр. риск, решение 13.10.2026): имя оставлено, чтобы старый код не упал, значок нейтральный
  instagram: Camera,
  // замены эмодзи интерфейса (Print 360, 06.10.2026)
  lock: Lock, unlock: Unlock, clipboard: ClipboardList, chart: ChartColumn, refresh: RefreshCw, ban: Ban, briefcase: Briefcase,
  link: Link, gift: Gift, idea: Lightbulb, factory: Factory, save: Save, shirt: Shirt, scissors: Scissors, layers: Layers,
  ruler: Ruler, home: House, film: Film, party: PartyPopper, tag: Tag, pin: Pin, folder: FolderOpen, receipt: Receipt,
  repeat: Repeat, trend: TrendingUp, tools: Wrench, place: MapPin, puzzle: Puzzle, flame: Flame, bot: Bot, bag: ShoppingBag,
  car: Car, monitor: Monitor, gem: Gem, food: UtensilsCrossed, help: CircleHelp, ribbon: Ribbon, dot: Circle, coins: Coins,
  note: StickyNote, hourglass: Hourglass, star: Star, truck: Truck, ok: CircleCheck, fail: CircleX, undo: Undo2, copy: Copy,
  external: ExternalLink, timer: Timer, archive: Archive, unarchive: ArchiveRestore, heart: Heart, like: ThumbsUp, mail: Mail,
  camera: Camera, image: Image,
  medical: Stethoscope, plane: Plane, flower: Flower2, mic: Mic, scale: Scale, sign: Signpost, trophy: Trophy, globe: Globe,
  cloud: Cloud, minus: Minus, contact: Contact, square: Square, news: Newspaper, flag: Flag, window: AppWindow, magnet: Magnet,
  baby: Baby, sport: Volleyball,

  // ===== v2 (13.10.2026) =====
  // новые разделы
  dashboard: LayoutDashboard, kb: LibraryBig, salary: HandCoins, promo: Rocket, store: Store,
  // соцсети и связь (Instagram — нет)
  vk: VkGlyph, telegram: TelegramGlyph, whatsapp: WhatsappGlyph, phoneCall: PhoneCall, messages: MessagesSquare,
  messageMore: MessageCircleMore, at: AtSign, hash: Hash, smartphone: Smartphone, laptop: Laptop,
  // оболочка и навигация
  panelLeft: PanelLeft, panelLeftOpen: PanelLeftOpen, panelLeftClose: PanelLeftClose, pinOff: PinOff, menu: Menu,
  chevronRight: ChevronRight, chevronLeft: ChevronLeft, chevronUp: ChevronUp, arrowRight: ArrowRight, arrowLeft: ArrowLeft,
  arrowDownRight: ArrowDownRight, arrowUpRight: ArrowUpRight, arrowDownLeft: ArrowDownLeft, moreVertical: EllipsisVertical,
  settings2: Settings, keyboard: Keyboard, command: Command, login: LogIn, power: Power, maximize: Maximize2, minimize: Minimize2,
  // тема и внешний вид
  sun: Sun, moon: Moon, sunMoon: SunMoon, palette: Palette, wand: WandSparkles, sparkle: Sparkle, sparkles: Sparkles,
  swatch: SwatchBook, pipette: Pipette, brush: Paintbrush, penTool: PenTool, type: Type, shapes: Shapes,
  // виды и раскладки
  layoutGrid: LayoutGrid, list: List, kanban: Kanban, table: Table2, columns: Columns3, rows: Rows3,
  listChecks: ListChecks, listTodo: ListTodo, filterList: ListFilter, sort: ArrowUpDown, drag: GripVertical,
  // время и даты
  calendarDays: CalendarDays, calendarCheck: CalendarCheck, calendarClock: CalendarClock, calendarRange: CalendarRange,
  clockAlert: ClockAlert, alarm: AlarmClock, history: History, play: Play, pause: Pause,
  // деньги и графики
  rocket: Rocket, target: Target, trendingUp: TrendingUp, trendingDown: TrendingDown, gauge: Gauge, activity: Activity,
  percent: Percent, ruble: RussianRuble, piggy: PiggyBank, receiptText: ReceiptText, dollarCircle: CircleDollarSign,
  chartLine: ChartLine, chartArea: ChartArea, chartBars: ChartNoAxesColumn, chartPie: ChartPie,
  // статусы и сигналы
  checkCheck: CheckCheck, circleDot: CircleDot, info: Info, alertCircle: CircleAlert, badgeCheck: BadgeCheck, award: Award,
  medal: Medal, eyeOff: EyeOff, bellRing: BellRing, bellOff: BellOff, siren: Siren, smile: Smile, shieldCheck: ShieldCheck,
  loader: LoaderCircle, bookmark: Bookmark, circlePlus: CirclePlus, circleMinus: CircleMinus, redo: Redo2, shuffle: Shuffle,
  // файлы, склад, производство
  qr: QrCode, folderClosed: Folder, fileImage: FileImage, fileText: FileText, images: Images, cloudUpload: CloudUpload,
  packageCheck: PackageCheck, packageOpen: PackageOpen, boxes: Boxes, sticker: Sticker, stamp: Stamp, layers2: Layers2,
  scan: ScanLine, printer: Printer, warehouse2: Warehouse, cart: ShoppingCart, tags: Tags, route: Route, building2: Building,
  pointer: MousePointerClick, link2: Link2, share: Share2, reply: Reply, userCheck: UserCheck, userCog: UserCog, bulb: Bulb,
};
