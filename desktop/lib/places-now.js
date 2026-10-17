// The engine's fingerprint of today's places (src/ai/locations.py), for a job's drawer: a score that used other places says "older places". Asked of the
// engine once, and again only when the search settings file changed (a stat, not a process per drawer). '' when it cannot be told: never "older".
// Guarded by test/locations-drawer.test.js.
import fs from 'node:fs';
import * as pipeline from './pipeline.js';

let memo = {stamp: null, places: ''};
const SETTINGS = 'config/search.json';
const modifiedOf = storage => { try { return fs.statSync(storage.path(SETTINGS)).mtimeMs; } catch { return 0; } };

export async function placesNow(storage, {run = pipeline.run, modified = modifiedOf} = {}) {
  const stamp = modified(storage);
  if (memo.stamp === stamp && stamp) return memo.places;
  const {code, stdout} = await run(storage, ['src.desktop', 'places-now']);
  if (code !== 0) return '';
  try { memo = {stamp, places: String(JSON.parse(stdout.trim().split('\n').pop()).places || '')}; } catch { return ''; }
  return memo.places;
}
