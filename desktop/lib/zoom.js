// How big the app is drawn: 80% on a laptop-size display, 100% on a larger one (owner, 17 Oct 2026), remembered across restarts, driven by ⌘- ⌘+ ⌘0 and by Settings → Appearance → Text size. Guarded by test/zoom.test.js.
export const LAPTOP_MAX_WIDTH = 1512;   // points: a 14" MacBook Pro is 1512 wide; anything up to it starts smaller
export const LAPTOP_FACTOR = 0.8;
export const STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const SIZE_SCALE = {small: 0.875, default: 1, large: 1.25};   // of the display's own default, so each screen's Small < Default < Large
const round = n => Math.round(n * 100) / 100;

export const defaultFactor = width => (width > 0 && width <= LAPTOP_MAX_WIDTH ? LAPTOP_FACTOR : 1);
export const clamp = n => Math.min(STEPS[STEPS.length - 1], Math.max(STEPS[0], n));
// The saved factor when there is one, else the display's default.
export const factorFor = (settings, width) => (typeof settings?.zoom === 'number' && Number.isFinite(settings.zoom) ? round(clamp(settings.zoom)) : defaultFactor(width));
// ⌘+ / ⌘-: the next step up or down from where it is now.
export function step(factor, direction) {
  const next = direction > 0 ? STEPS.find(s => s > round(factor) + 0.001) : [...STEPS].reverse().find(s => s < round(factor) - 0.001);
  return next ?? round(factor);
}
export const factorOfChoice = (choice, width) => round(defaultFactor(width) * (SIZE_SCALE[choice] ?? 1));
// Which Text size choice the factor is: one of the three, or null (⌘+ went somewhere between).
export const choiceOf = (factor, width) => Object.keys(SIZE_SCALE).find(choice => factorOfChoice(choice, width) === round(factor)) ?? null;
