// gridScroll.ts — the reject grid's last known scroll offset. The shredder
// mounts on top of the reject pile and needs to know where each print sits
// on screen to fly it to the pile; the grid writes here on every scroll and
// the shredder reads it once at mount. Nothing re-renders on scroll.

export const rejectsGrid = { scrollTop: 0 };
