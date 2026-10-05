'use client';

// Catalog families name their icon by Phosphor name (lib/training.ts CatalogFamily.icon.phosphor).
// A closed map keeps the bundle small; unknown names fall back to a chat bubble.
import {
  AddressBookIcon, AirplaneIcon, ArrowCounterClockwiseIcon, ArrowRightIcon, ClipboardTextIcon, EnvelopeSimpleIcon, HandPalmIcon, MapTrifoldIcon, PhoneIcon, ScissorsIcon, AirplaneTiltIcon, ArrowsClockwiseIcon, ArrowsLeftRightIcon, AtomIcon, BankIcon, BarbellIcon, BedIcon,
  BellIcon, BookOpenIcon, BookOpenTextIcon, BrainIcon, BriefcaseIcon, BuildingsIcon, CalendarCheckIcon, CameraIcon, CarIcon, CertificateIcon,
  ChartBarIcon, ChatCenteredDotsIcon, ChatCircleDotsIcon, ChatCircleTextIcon, ChatsCircleIcon, ChatsIcon, ChatTeardropTextIcon, ClockIcon,
  CoffeeIcon, CoinsIcon, CompassIcon, CreditCardIcon, CurrencyDollarIcon, CurrencyEurIcon, DetectiveIcon, EarIcon, EnvelopeIcon, EyeIcon,
  FilmSlateIcon, FilmStripIcon, FireIcon, FlagIcon, ForkKnifeIcon, GameControllerIcon, GlobeIcon, GraduationCapIcon, HandCoinsIcon,
  HandshakeIcon, HandWavingIcon, HourglassMediumIcon, HouseIcon, HouseLineIcon, IdentificationCardIcon, KeyIcon, LightbulbIcon,
  LightningIcon, ListChecksIcon, LockSimpleIcon, MagnifyingGlassIcon, MapPinIcon, MegaphoneIcon, MicrophoneIcon, MoneyIcon,
  MonitorPlayIcon, NotebookIcon, NotepadIcon, PaintBrushIcon, PaletteIcon, PaperPlaneTiltIcon, PathIcon, PencilSimpleIcon,
  PencilSimpleLineIcon, PercentIcon, PiggyBankIcon, PresentationChartIcon, ProhibitIcon, QuestionIcon, QuotesIcon, ReceiptIcon,
  RobotIcon, RocketIcon, ScalesIcon, SealCheckIcon, ShieldCheckIcon, SignatureIcon, SimCardIcon, SmileyIcon, SoccerBallIcon,
  SparkleIcon, StorefrontIcon, StrategyIcon, SuitcaseIcon, SuitcaseRollingIcon, TargetIcon, TicketIcon, TimerIcon, TrainIcon,
  TranslateIcon, TrophyIcon, UserCircleIcon, UserFocusIcon, UsersIcon, UsersThreeIcon, VideoCameraIcon, WalletIcon, WaveformIcon,
  type Icon, type IconWeight,
} from '@phosphor-icons/react';

const ICONS: Record<string, Icon> = {
  AddressBook: AddressBookIcon, Airplane: AirplaneIcon, ArrowCounterClockwise: ArrowCounterClockwiseIcon, ArrowRight: ArrowRightIcon,
  ClipboardText: ClipboardTextIcon, EnvelopeSimple: EnvelopeSimpleIcon, HandPalm: HandPalmIcon, MapTrifold: MapTrifoldIcon, Phone: PhoneIcon, Scissors: ScissorsIcon, AirplaneTilt: AirplaneTiltIcon, ArrowsClockwise: ArrowsClockwiseIcon,
  ArrowsLeftRight: ArrowsLeftRightIcon, Atom: AtomIcon, Bank: BankIcon, Barbell: BarbellIcon, Bed: BedIcon, Bell: BellIcon,
  BookOpen: BookOpenIcon, BookOpenText: BookOpenTextIcon, Brain: BrainIcon, Briefcase: BriefcaseIcon, Buildings: BuildingsIcon,
  CalendarCheck: CalendarCheckIcon, Camera: CameraIcon, Car: CarIcon, Certificate: CertificateIcon, ChartBar: ChartBarIcon,
  ChatCenteredDots: ChatCenteredDotsIcon, ChatCircleDots: ChatCircleDotsIcon, ChatCircleText: ChatCircleTextIcon,
  ChatsCircle: ChatsCircleIcon, Chats: ChatsIcon, ChatTeardropText: ChatTeardropTextIcon, Clock: ClockIcon, Coffee: CoffeeIcon,
  Coins: CoinsIcon, Compass: CompassIcon, CreditCard: CreditCardIcon, CurrencyDollar: CurrencyDollarIcon, CurrencyEur: CurrencyEurIcon,
  Detective: DetectiveIcon, Ear: EarIcon, Envelope: EnvelopeIcon, Eye: EyeIcon, FilmSlate: FilmSlateIcon, FilmStrip: FilmStripIcon,
  Fire: FireIcon, Flag: FlagIcon, ForkKnife: ForkKnifeIcon, GameController: GameControllerIcon, Globe: GlobeIcon,
  GraduationCap: GraduationCapIcon, HandCoins: HandCoinsIcon, Handshake: HandshakeIcon, HandWaving: HandWavingIcon,
  HourglassMedium: HourglassMediumIcon, House: HouseIcon, HouseLine: HouseLineIcon, IdentificationCard: IdentificationCardIcon,
  Key: KeyIcon, Lightbulb: LightbulbIcon, Lightning: LightningIcon, ListChecks: ListChecksIcon, LockSimple: LockSimpleIcon,
  MagnifyingGlass: MagnifyingGlassIcon, MapPin: MapPinIcon, Megaphone: MegaphoneIcon, Microphone: MicrophoneIcon, Money: MoneyIcon,
  MonitorPlay: MonitorPlayIcon, Notebook: NotebookIcon, Notepad: NotepadIcon, PaintBrush: PaintBrushIcon, Palette: PaletteIcon,
  PaperPlaneTilt: PaperPlaneTiltIcon, Path: PathIcon, PencilSimple: PencilSimpleIcon, PencilSimpleLine: PencilSimpleLineIcon,
  Percent: PercentIcon, PiggyBank: PiggyBankIcon, PresentationChart: PresentationChartIcon, Prohibit: ProhibitIcon,
  Question: QuestionIcon, Quotes: QuotesIcon, Receipt: ReceiptIcon, Robot: RobotIcon, Rocket: RocketIcon, Scales: ScalesIcon,
  SealCheck: SealCheckIcon, ShieldCheck: ShieldCheckIcon, Signature: SignatureIcon, SimCard: SimCardIcon, Smiley: SmileyIcon,
  SoccerBall: SoccerBallIcon, Sparkle: SparkleIcon, Storefront: StorefrontIcon, Strategy: StrategyIcon, Suitcase: SuitcaseIcon,
  SuitcaseRolling: SuitcaseRollingIcon, Target: TargetIcon, Ticket: TicketIcon, Timer: TimerIcon, Train: TrainIcon,
  Translate: TranslateIcon, Trophy: TrophyIcon, UserCircle: UserCircleIcon, UserFocus: UserFocusIcon, Users: UsersIcon,
  UsersThree: UsersThreeIcon, VideoCamera: VideoCameraIcon, Wallet: WalletIcon, Waveform: WaveformIcon,
};

export function catalogIcon(name: string | null | undefined): Icon {
  const key = typeof name === 'string' ? name.replace(/Icon$/u, '') : '';
  return ICONS[key] ?? ChatsCircleIcon;
}

export function CatalogIcon({ name, size = 24, weight = 'duotone' }: { name: string | null | undefined; size?: number; weight?: IconWeight }) {
  const Component = catalogIcon(name);
  return <Component size={size} weight={weight} aria-hidden="true" />;
}
