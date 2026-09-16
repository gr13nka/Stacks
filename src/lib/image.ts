// image.ts — warms the webview's image cache so a URL swap paints at once.
// A rotated photo gets a new thumb URL; the store waits for it here before
// swapping the photo in, so the card never shows an empty frame mid-turn.

/** Resolves once `url` is fetched and decoded — or failed to; a slow or broken thumb must never block the caller. */
export function preloadImage(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  const img = new Image();
  img.src = url;
  return img.decode().catch(() => {});
}
