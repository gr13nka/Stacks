// tokens.ts — every colour, size, rect, spring and gesture constant in the app.
// Pure data plus a few pure geometry helpers. No DOM, no React. All rects are
// in "frame" coordinates (the 390×844 phone frame, origin top-left) unless a
// helper says otherwise. Angles are degrees, lengths are px, times are ms.

export type Rect = { x: number; y: number; w: number; h: number };
export type RectRot = Rect & { rot: number };
export type Spring = { stiffness: number; damping: number; mass: number };

export const DESKTOP = import.meta.env.VITE_STACKS_DESKTOP === '1';
export const FRAME = DESKTOP ? { w: 1280, h: 720 } as const : { w: 390, h: 844 } as const;

export const STORAGE_KEY = 'stacks/v1';

export const COLOR = {
  ground: '#DCE3DE',   // pale mint-grey desk
  paper: '#FBFBF7',    // print borders, badges, buttons
  ink: '#22302B',      // active text
  muted: '#8B9791',    // inactive / secondary text
  accent: '#1F3BFF',   // month names, place names, done days, keep tick
  stamp: '#FF7A1A',    // orange film date stamp + reject tape
  edge: '#EEEAE0',     // thin "thickness" sliver on paper objects
  shadow: '#4A3F2E',   // every shadow is this warm colour at some alpha
  cavity: '#1C211F',   // shredder cavity
  seam: '#2A302D',     // shredder seam slot
  wash: 'rgba(255,255,255,0.5)',
} as const;

export const FONT = {
  family: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  weight: 400,
  letterSpacing: '0',
} as const;

export const TYPE = {
  caption: { size: 13, lineHeight: 18 },
  label: { size: 15, lineHeight: 22 },
  month: { size: 22, lineHeight: 28 },
  day: { size: 14, lineHeight: 18 },
  stamp: { size: 15, lineHeight: 18, weight: 500, letterSpacing: '0.04em' },
  badge: { size: 9, lineHeight: 14 },
} as const;

export const SHADOW = {
  rest: '0 10px 24px rgba(74,63,46,0.18), 0 2px 6px rgba(74,63,46,0.10)',
  lifted: '0 22px 44px rgba(74,63,46,0.24), 0 6px 14px rgba(74,63,46,0.12)',
  paperInset: 'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 0 0 1px rgba(0,0,0,0.05)',
  seamLip: 'inset 0 6px 8px -4px rgba(0,0,0,0.6)',
  stampGlow: '0 0 4px rgba(255,122,26,0.65), 0 0 1px rgba(255,150,60,0.9)', // text-shadow
} as const;

// Film grain: Stamps2's feTurbulence data-URI in styles.css, above the ground, below prints.
export const GRAIN = { opacity: 0.05 } as const;

export const PRINT = {
  border: { cell: 3, card: 8, reject: 3 }, // white paper border per print size
  rawBadge: { h: 14, pad: 4 },             // pad = inset from the image corner
  tape: { w: 0.9, h: 18, rot: -28, opacity: 0.55 }, // reject tape: width as a fraction of the print
  stampInset: { card: 14, cell: 3 },       // date stamp inset from the image corner
  stampScale: { card: 1, cell: 0.55 },     // the cell stamp is the card stamp scaled down
} as const;

// Press-and-hold "pick up" state shared by every physical object.
export const PICKUP = { scale: 1.03, rotate: 1.5 } as const;

// Spring presets lifted from the mockups (stiffness / damping / mass).
export const SPRING = {
  SNAP: { stiffness: 420, damping: 40, mass: 1 },
  SETTLE: { stiffness: 260, damping: 18, mass: 1 },
  GLIDE: { stiffness: 200, damping: 26, mass: 1 },
  ENTER: { stiffness: 150, damping: 21, mass: 1 },
  SHUT: { stiffness: 140, damping: 30, mass: 1.4 },
  HEAVY: { stiffness: 120, damping: 15, mass: 1.4 },
  DRIFT: { stiffness: 90, damping: 20, mass: 1 },
} as const satisfies Record<string, Spring>;

// Which preset drives which motion. Opening motions have a little weight;
// closing motions hit a solid stop (asymmetric, as in the mockups).
export const MOTION = {
  heroIn: SPRING.GLIDE,
  heroOut: SPRING.SHUT,
  backdrop: SPRING.SNAP,
  chrome: SPRING.SETTLE,
  press: SPRING.SNAP,
  release: SPRING.SETTLE,
  cardPromote: SPRING.SETTLE,
  cardKeep: SPRING.GLIDE,
  cardReject: SPRING.ENTER,
  cardReturn: SPRING.SETTLE,
  behindEnter: SPRING.ENTER,
  modeSwap: SPRING.SNAP,
  feed: SPRING.HEAVY,
  jolt: SPRING.SNAP,
  strip: SPRING.DRIFT,
  feedReturn: SPRING.SHUT,
  flight: SPRING.ENTER,
  rescue: SPRING.SNAP,
} as const satisfies Record<string, Spring>;

export const GESTURE = {
  tapSlop: 8,          // px of travel before a press becomes a drag
  tapTime: 400,        // ms; longer than this is not a tap
  longPress: 500,      // ms held without moving
  velocityEma: 0.32,   // smoothing of pointer velocity
  projectMs: 120,      // release position is projected this far ahead
  commit: 0.3,         // fraction of travel that commits a page turn
  throwDamping: 0.7,   // release velocity carried into the spring
} as const;

// Chrome (overlay hint, mode-swap lists) enters from this many px below its rest.
export const CHROME = { rise: 16 } as const;

// Top icon bar: calendar, places, rejects, settings at x 236 / 272 / 308 / 344.
export const TOPBAR = { h: 56, iconY: 17, icon: 22, gap: 14, right: 24, target: 36, slots: 4 } as const;

/** Glyph rect of top-bar slot i (0 = calendar … 3 = settings), right-aligned. */
export function topbarIconRect(i: number): Rect {
  const x = FRAME.w - TOPBAR.right - TOPBAR.icon - (TOPBAR.slots - 1 - i) * (TOPBAR.icon + TOPBAR.gap);
  return { x, y: TOPBAR.iconY, w: TOPBAR.icon, h: TOPBAR.icon };
}

/** The 36×36 pointer target centred on a glyph rect. */
export function topbarTargetRect(i: number): Rect {
  const g = topbarIconRect(i);
  const pad = (TOPBAR.target - TOPBAR.icon) / 2;
  return { x: g.x - pad, y: g.y - pad, w: TOPBAR.target, h: TOPBAR.target };
}

// The 4-column grid both list screens share: one 75×86 cell per day (calendar)
// or per stack (places), a 58×58 print seated inside, a day number above it.
export const CAL = {
  // Desktop keeps the calendar in a centred 4:3 work area rather than
  // spreading its cells across the full 16:9 frame.
  cols: DESKTOP ? 8 : 4,
  marginX: DESKTOP ? 256 : 24,
  gutterX: DESKTOP ? 24 : 14,
  cell: { w: 75, h: 86 },
  rowGap: 10,
  headerH: 48,
  padBottom: 20,
  print: { w: 58, h: 58, border: 3 },
  printInset: { x: 8, y: 22 },       // print's top-left inside its cell
  dayNumber: { x: 2, y: 0 },         // day number's top-left inside its cell
  hairline: { gap: 3, h: 2 },        // progress hairline below the print
  tilt: [-7, 5, -4, 8, -6, 3, 7, -5],
  fan: { dx: 7, dy: -5, rot: 9 },    // offset of each extra stack on a multi-session day
  header: { captionY: 14, monthY: 10 },
  scrollerY: 56,                     // the scroller's top edge in frame coords
  scrollerH: FRAME.h - TOPBAR.h,
  windowScreens: 1.5,                // blocks further than this many screens away render empty
  z: { seatedBase: 10, opening: 90000 },
} as const;

/** Cell i of a grid block, in block-local coords: 4 per row, left to right, top to bottom. */
export function gridCellRect(i: number): Rect {
  return {
    x: CAL.marginX + (i % CAL.cols) * (CAL.cell.w + CAL.gutterX),
    y: CAL.headerH + Math.floor(i / CAL.cols) * (CAL.cell.h + CAL.rowGap),
    w: CAL.cell.w,
    h: CAL.cell.h,
  };
}

/** Height of a grid block holding `cells` cells; pure arithmetic so scroll offsets never measure the DOM. */
export function gridBlockHeight(cells: number): number {
  const rows = Math.max(1, Math.ceil(cells / CAL.cols));
  return CAL.headerH + rows * CAL.cell.h + (rows - 1) * CAL.rowGap + CAL.padBottom;
}

/** Calendar cell i in month-block-local coords. i = daysInMonth − day: the last day sits at i=0 (top-left), day 1 last. */
export function dayCellRect(i: number): Rect {
  return gridCellRect(i);
}

/** Height of a month block with `days` days. */
export function monthBlockHeight(days: number): number {
  return gridBlockHeight(days);
}

export const DECK = {
  box: DESKTOP ? { x: 390, y: 90, w: 500, h: 500 } : { x: 25, y: 116, w: 340, h: 452 },
  counter: { x: DESKTOP ? 40 : 24, y: 72 },
  behind: [
    { dy: 12, rot: -3, scale: 0.965 },
    { dy: 22, rot: 2.5, scale: 0.93 },
    { dy: 30, rot: -1.5, scale: 0.9 },
  ],
  edge: { x: -46, y: DESKTOP ? 470 : 590, w: 96, h: 128, rot: -14 },
  commitDx: 120,       // projected travel that commits a swipe
  commitVx: 0.9,       // px/ms release velocity that commits a swipe
  tiltPerPx: 1 / 18,   // card rotation per px of drag
  flyX: 620,           // where a kept card flies to
  flyRot: 22,
  stampInset: 14,      // date stamp inset from the image corner
  dragY: 0.3,          // vertical drag is damped to this fraction
  hint: { dx: 40, fade: 40 },   // out tape / keep tick fade in from |dx| = dx over `fade` px
  tick: { size: 56, inset: 22 }, // the blue keep tick, top-right inside the card
  pileSize: 4,         // cards mounted at once (top + DECK.behind)
  edgeJolt: 1.08,      // reject edge scale bump when a card lands on it
  edgeCount: { x: 62, y: DESKTOP ? 484 : 604 },
  decisionMs: 150,     // short, serialized feedback before the next card advances
  turnMs: 180,         // a tap's quarter turn of the top card
} as const;

export const REJECTS = {
  cols: DESKTOP ? 10 : 3,
  marginX: DESKTOP ? 50 : 24,
  gridY: DESKTOP ? 100 : 140,
  cell: { w: 106, h: 106 },
  gutter: 12,
  print: { w: 88, h: 88 },
  hero: { x: DESKTOP ? 50 : 24, y: 96, w: 96, h: 128, rot: 0 },
  button: { y: DESKTOP ? 650 : 760 },
  captionH: 26,        // the day caption row above each group
  groupGap: 14,        // space after a group's last row
  scrollerH: DESKTOP ? 538 : 608,
  emptyY: 300,         // "nothing to shred" caption
} as const;

export const SHREDDER = {
  pile: { x: DESKTOP ? 540 : 95, y: DESKTOP ? 100 : 150, w: 200, h: 200 },
  pileTilt: [-4, 3, -2, 5, -3, 2],
  seam: { y: DESKTOP ? 360 : 420, h: 18 },
  strips: 7,
  stripFall: 300,      // px a strip falls below the seam before fading out
  feedStagger: 260,    // ms between successive prints entering the seam
  maxFeedMs: 6000,     // a big pile compresses the stagger so the whole feed fits in this
  jolt: 1.12,          // seam scaleY when a print is swallowed
  button: { y: DESKTOP ? 650 : 760 },
  print: { w: 200, h: 200, border: 3 }, // prints on the pile (strips are print.w / strips wide)
  sink: 0.6,           // fraction of the print's height that goes below the seam
  feedScale: 0.92,     // print scale at the end of the feed
  knee: 0.55,          // feed progress at which the seam jolts and the strips appear
  stripStep: 9,        // each strip trails the previous by this many px
  stripTilt: 2,        // strips alternate ± this rotation
  flightStagger: 15,   // ms between prints flying in from the reject grid
  maxFlights: 24,      // prints beyond this many just appear on the pile
  pileVisible: 12,     // seated prints drawn at once (the rest wait under the top ones)
  slotW: 240,          // the lighter seam slot on the cavity
  statusY: DESKTOP ? 312 : 372,
  counterDy: 24,       // countdown caption below the seam slot
  undoMs: 20000,       // undo stays available this long after a shred
  z: { pile: 10, cavity: 500, strips: 510, flight: 600 }, // inside the shredder overlay; chrome is LAYER.chrome
} as const;

// One list row (components/Rows) and the gap above a section header, shared by settings and the location picker.
export const ROW = { h: 52, sectionGap: 16 } as const;

export const SETTINGS = {
  rowY0: 96,
  labelX: 24,
  valueRight: 24,
  scroller: { y: 56, h: DESKTOP ? 584 : 708 },
  stepW: 32,                    // width of the − / + buttons
} as const;

// Back affordance: the tappable band at the bottom of every overlay and its hint line.
export const BACK = DESKTOP ? { y: 640, h: 80, hintY: 676 } as const : { y: 764, h: 80, hintY: 800 } as const;

// The location picker: a title, a caption, the search field, then a scroller
// of place and city rows that ends where the back band begins. Desktop keeps
// it in a centred column like the settings rows.
export const LOCATE = {
  x: DESKTOP ? 400 : 24,
  w: DESKTOP ? 480 : FRAME.w - 48,
  titleY: 64,
  captionY: 96,
  field: { y: 124, h: 44 },
  scroller: { y: 176, h: BACK.y - 176 },
  debounceMs: 120,     // typing pause before the city search runs
} as const;

// Stacking of the screen overlays inside the frame. The icon bar sits above
// every screen but below prints in flight. `chrome` is local to an overlay:
// its chrome slot always sits above the overlay's own content.
export const LAYER = { main: 0, deck: 10, rejects: 20, shredder: 30, settings: 40, locate: 45, iconBar: 50, flight: 100, chrome: 1000 } as const;

/** Rises from 0 at the ends to 1 in the middle: the shade / lift envelope. */
export function hump(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 4 * c * (1 - c);
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
