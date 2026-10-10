// The shapes whose ladder ended with no usable answer ("other"): a count per page shape (host + path template | build, as page-kind.js kindKey), nothing else. Fixed values and integers only:
// no sentence, address, query or number of the page can be stored. The counts are what the pack reporter sends (lib/recipes.js, wired by the learning owner) so a recipe can be added as data.
// The file (ladder-other.json) is a cache: deleting it only loses the counts. Guard: desktop/test/ladder-other.test.js.
import fs from 'node:fs';

const SHAPE = /^[a-z0-9._-]{1,80}(\/[a-z0-9._*-]{0,60}){0,8}\|[a-z0-9-]{1,12}$/;   // as ladder-learning.js (not exported there): no query, no space, no @, no sentence
const MAX_SHAPES = 500;

export function otherStore(file) {
  const data = {};
  try { for (const [shape, n] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')) || {})) if (SHAPE.test(shape) && Number.isInteger(n) && n > 0) data[shape] = Math.min(n, 1e6); } catch { /* none yet, or unreadable */ }
  return {data, save: () => { try { fs.writeFileSync(file, JSON.stringify(data)); } catch { /* read-only: the counts of this run only */ } }};
}

// Count one "other" for the shape. -> was it a real shape?
export function record(store, shape) {
  if (!SHAPE.test(String(shape ?? ''))) return false;
  if (!(shape in store.data) && Object.keys(store.data).length >= MAX_SHAPES) delete store.data[Object.keys(store.data)[0]];   // the oldest shape makes room
  store.data[shape] = Math.min((store.data[shape] || 0) + 1, 1e6);
  store.save();
  return true;
}

// -> [{shape, n}] sorted by shape: fixed values and integers only.
export const counts = store => Object.entries(store.data).map(([shape, n]) => ({shape, n})).sort((a, b) => a.shape.localeCompare(b.shape));
