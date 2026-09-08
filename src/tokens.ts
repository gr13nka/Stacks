// tokens.ts — every colour, size, rect, spring and gesture constant in the app.
// Pure data plus a few pure geometry helpers. No DOM, no React. All rects are
// in "frame" coordinates (the 1280×800 landscape frame, origin top-left)
// unless a helper says otherwise. Angles are degrees, lengths are px, times
// are ms.
//
// The frame is a fixed design size that App scales to fit the window, so every
// rect here stays a constant and no layout ever measures the DOM. Widths that
// have to add up exactly are noted where they do.

export type Rect = { x: number; y: number; w: number; h: number };
export type RectRot = Rect & { rot: number };
export type Spring = { stiffness: number; damping: number; mass: number };

export const FRAME = { w: 1280, h: 800 } as const;

// The window is free to be any shape; the frame scales to fit and lies centred on
// the desk, inset by this margin, with SHADOW.lifted under its rounded corners.
export const DESK = { margin: 24, radius: 20 } as const;

export const STORAGE_KEY = 'stacks/v1';

export const COLOR = {
  ground: '#DCE3DE',   // pale mint-grey surface inside the frame
  desk: '#C7D0CA',     // a step deeper: the desk the frame lies on outside it
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
export const TOPBAR = { h: 56, iconY: 17, icon: 22, gap: 18, right: 48, target: 36, slots: 4 } as const;

// The four places the icon bar can reach, in bar order — which is also the
// order of the slot rects below, so a destination's hero always flies from its
// own glyph whether it was tapped or reached by its number key.
export const TOPBAR_SLOTS = ['calendar', 'places', 'rejects', 'settings'] as const;
export type Destination = (typeof TOPBAR_SLOTS)[number];

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

// The 10-column grid both list screens share: one 104×112 cell per day
// (calendar) or per stack (places), an 80×80 print seated inside, a day number
// above it. A whole month is four rows, so most of a year is one glance.
// The row adds up exactly: 10·104 + 9·16 + 2·48 = 1280 = FRAME.w.
export const CAL = {
  cols: 10,
  marginX: 48,
  gutterX: 16,
  cell: { w: 104, h: 112 },
  rowGap: 12,
  headerH: 48,
  padBottom: 24,
  print: { w: 80, h: 80, border: 3 },
  printInset: { x: 12, y: 26 },      // print's top-left inside its cell
  dayNumber: { x: 2, y: 0 },         // day number's top-left inside its cell
  hairline: { gap: 4, h: 2 },        // progress hairline below the print
  tilt: [-7, 5, -4, 8, -6, 3, 7, -5],
  fan: { dx: 9, dy: -7, rot: 9 },    // offset of each extra stack on a multi-session day
  header: { captionY: 14, monthY: 10 },
  scrollerY: 56,                     // the scroller's top edge in frame coords
  scrollerH: 744,                    // FRAME.h − TOPBAR.h
  windowScreens: 1.5,                // blocks further than this many screens away render empty
  z: { seatedBase: 10, opening: 90000 },
} as const;

/** Cell i of a grid block, in block-local coords: CAL.cols per row, left to right, top to bottom. */
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

// The card is the point of the whole app, so on a laptop it takes the room.
// The box is shaped for 3:2 — 882×588 of image inside an 8px border — so the
// commonest photo fills it exactly and everything else is letterboxed inside.
// Centred: x = (1280 − 898) / 2.
export const DECK = {
  box: { x: 191, y: 96, w: 898, h: 604 },   // the top card fits its aspect inside this, centred
  counter: { x: 48, y: 72 },
  behind: [
    { dy: 16, rot: -3, scale: 0.965 },
    { dy: 28, rot: 2.5, scale: 0.93 },
    { dy: 38, rot: -1.5, scale: 0.9 },
  ],
  edge: { x: -46, y: 560, w: 96, h: 128, rot: -14 }, // the reject edge, half off-screen
  commitDx: 180,       // projected travel that commits a swipe
  commitVx: 0.9,       // px/ms release velocity that commits a swipe
  tiltPerPx: 1 / 24,   // card rotation per px of drag
  flyX: 1400,          // where a kept card flies to (clear of a 900-wide box)
  flyRot: 22,
  stampInset: 20,      // date stamp inset from the image corner
  dragY: 0.3,          // vertical drag is damped to this fraction
  hint: { dx: 60, fade: 60 },   // out tape / keep tick fade in from |dx| = dx over `fade` px
  tick: { size: 88, inset: 32 }, // the blue keep tick, top-right inside the card
  pileSize: 4,         // cards mounted at once (top + DECK.behind)
  edgeJolt: 1.08,      // reject edge scale bump when a card lands on it
  edgeCount: { x: 62, y: 574 }, // the reject count next to the edge
} as const;

// 8·134 + 7·16 + 2·48 = 1280 = FRAME.w.
export const REJECTS = {
  cols: 8,
  marginX: 48,
  gridY: 140,
  cell: { w: 134, h: 134 },
  gutter: 16,
  print: { w: 112, h: 112 },
  hero: { x: 48, y: 96, w: 96, h: 128, rot: 0 },
  button: { y: 716 },
  captionH: 26,        // the day caption row above each group
  groupGap: 16,        // space after a group's last row
  scrollerH: 564,      // gridY .. button.y − 12
  emptyY: 320,         // "nothing to shred" caption
} as const;

// The pile is centred on the frame (x = (1280 − 240) / 2) above a seam that
// runs across the middle, with the cavity filling everything below it.
export const SHREDDER = {
  pile: { x: 520, y: 120, w: 240, h: 240 },
  pileTilt: [-4, 3, -2, 5, -3, 2],
  seam: { y: 400, h: 20 },
  strips: 7,
  stripFall: 320,      // px a strip falls below the seam before fading out
  feedStagger: 260,    // ms between successive prints entering the seam
  maxFeedMs: 6000,     // a big pile compresses the stagger so the whole feed fits in this
  jolt: 1.12,          // seam scaleY when a print is swallowed
  button: { y: 716 },
  print: { w: 240, h: 240, border: 3 }, // prints on the pile (strips are print.w / strips wide)
  sink: 0.6,           // fraction of the print's height that goes below the seam
  feedScale: 0.92,     // print scale at the end of the feed
  knee: 0.55,          // feed progress at which the seam jolts and the strips appear
  stripStep: 11,       // each strip trails the previous by this many px
  stripTilt: 2,        // strips alternate ± this rotation
  flightStagger: 15,   // ms between prints flying in from the reject grid
  maxFlights: 24,      // prints beyond this many just appear on the pile
  pileVisible: 12,     // seated prints drawn at once (the rest wait under the top ones)
  slotW: 420,          // the lighter seam slot on the cavity
  statusY: 352,        // status caption above the seam
  counterDy: 24,       // countdown caption below the seam slot
  undoMs: 20000,       // undo stays available this long after a shred
  z: { pile: 10, cavity: 500, strips: 510, flight: 600 }, // inside the shredder overlay; chrome is LAYER.chrome
} as const;

// labelX / valueRight are the settings column's side padding: a full-width row
// would strand the value 1200px from its label, so the column is 640 centred.
export const SETTINGS = {
  rowY0: 96,
  rowH: 52,
  labelX: 320,                  // (FRAME.w − 640) / 2
  valueRight: 320,
  scroller: { y: 56, h: 664 },  // TOPBAR.h .. BACK.y
  stepW: 32,                    // width of the − / + buttons
  sectionGap: 16,
} as const;

// Back affordance: the tappable band at the bottom of every overlay and its hint line.
export const BACK = { y: 720, h: 80, hintY: 756 } as const;

// Stacking of the screen overlays inside the frame. The icon bar sits above
// every screen but below prints in flight. `chrome` is local to an overlay:
// its chrome slot always sits above the overlay's own content.
export const LAYER = { main: 0, deck: 10, rejects: 20, shredder: 30, settings: 40, iconBar: 50, flight: 100, chrome: 1000 } as const;

/** Rises from 0 at the ends to 1 in the middle: the shade / lift envelope. */
export function hump(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 4 * c * (1 - c);
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
