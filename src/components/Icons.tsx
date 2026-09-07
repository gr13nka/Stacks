// Icons.tsx — the four top-bar glyphs as inline SVG, 22×22, drawn in
// currentColor with a 1.6px stroke so they read as pen marks next to the
// monospace type.

import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 22,
  height: 22,
  viewBox: '0 0 22 22',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function CalendarGlyph() {
  return (
    <svg {...base}>
      <rect x="3" y="5" width="16" height="14" rx="1.5" />
      <path d="M3 9.5h16M7.5 3v3.5M14.5 3v3.5" />
      <path d="M7 13h2M11 13h2M15 13h1M7 16h2M11 16h2" strokeWidth={1.4} />
    </svg>
  );
}

export function PlacesGlyph() {
  return (
    <svg {...base}>
      <path d="M11 19.5c-3.6-4.2-5.5-7.3-5.5-9.9a5.5 5.5 0 1 1 11 0c0 2.6-1.9 5.7-5.5 9.9z" />
      <circle cx="11" cy="9.5" r="2" />
    </svg>
  );
}

export function RejectsGlyph() {
  return (
    <svg {...base}>
      <rect x="4" y="6" width="12" height="12" rx="1" transform="rotate(-8 10 12)" />
      <rect x="7.5" y="3.5" width="12" height="12" rx="1" transform="rotate(6 13.5 9.5)" />
      <path d="M9.5 8.5l6 5" strokeWidth={2.2} />
    </svg>
  );
}

export function SettingsGlyph() {
  return (
    <svg {...base}>
      <path d="M3 7.5h16M3 14.5h16" />
      <circle cx="8" cy="7.5" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14.5" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
