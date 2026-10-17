// Text size in the window: the font tokens never draw smaller than 10 px on screen at any zoom (the 80% laptop default would make 11 px text 8.8 px), and the words under Settings → Appearance → Text size. Guarded by test/zoom.test.js.
export const MIN_ON_SCREEN_PX = 10;
const BASE = {'--fs-xs': 11, '--fs-sm': 12};   // tokens.css
// The token sizes to set so the smallest text stays readable at this zoom factor ({} when nothing needs raising).
export function floorTokens(factor) {
  const out = {};
  for (const [name, base] of Object.entries(BASE)) {
    const needed = Math.ceil(MIN_ON_SCREEN_PX / (factor || 1) * 10) / 10;
    if (needed > base) out[name] = `${needed}px`;
  }
  return out;
}
export const SIZE_TEXT = {
  small: 'Smaller text, more on screen.',
  default: 'Fits your screen: 80% on a laptop, 100% on a large display.',
  large: 'Bigger text, easier to read.',
  other: 'A custom size from ⌘+ and ⌘-. ⌘0 goes back to Default.',
};
