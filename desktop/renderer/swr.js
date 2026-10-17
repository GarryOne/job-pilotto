// Profile tabs show what was read last time at once and read again behind it (owner, 17 Oct 2026: "big lag of loading, 5s+"); a skeleton card shows only while nothing is kept.
// Guarded by test/profile-swr.test.js.
const kept = new Map();   // key → the last good answer of that read, for this window's life
export const keptValue = key => kept.get(key);
export const keep = (key, value) => { if (value) kept.set(key, value); };
export const forgetKept = () => kept.clear();   // tests

// swr(key, read, {paint, loading, fail}): kept answer → paint(answer, true) now; then read() → paint(fresh, false) when it is ok, else fail(answer) (a kept paint stays on a failed refresh).
// paint's second argument says "this is the kept copy"; the refresh paints are the caller's to skip when the person has edits under way.
export async function swr(key, read, {paint, loading = () => {}, fail = () => {}}) {
  const had = kept.get(key);
  if (had) paint(had, true); else loading();
  const fresh = await read().catch(error => ({ok: false, error: error.message}));
  if (fresh?.ok === false) { if (!had) fail(fresh); return fresh; }
  keep(key, fresh);
  paint(fresh, false);
  return fresh;
}
