// Controlled randomness for the end-to-end suites: each scheduled run takes a different path through the same app (page order, control order, window size), so repeated
// runs find different bugs. The seed is printed, written to seed.json and shown in every issue, so a finding can be replayed: E2E_SEED=<n> node suite.mjs <suite>.
// No E2E_SEED (or 0) = FIXED: the same order every time. The release gate runs fixed (e2e.yml), so a build is judged on a path that does not move under it.

// mulberry32: small, fast, good enough to shuffle a menu.
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The window sizes a person really has: the app's smallest (rail), just under the rail limit, the default, a big screen.
export const WINDOW_SIZES = [[1024, 700], [1100, 720], [1179, 760], [1280, 820], [1440, 900], [1680, 1000]];

export function createVariation(env = process.env) {
  const raw = String(env.E2E_SEED ?? '').trim();
  const seed = /^\d+$/.test(raw) ? Number(raw) % 4294967296 : 0;
  const fixed = seed === 0;
  const next = generator(seed || 1);
  const shuffle = list => {
    const out = [...list];
    if (fixed) return out;
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  const pick = list => (fixed ? list.find(item => Array.isArray(item) && item[0] === 1280) || list[0] : list[Math.floor(next() * list.length)]);
  return {seed, fixed, shuffle, pick};
}
