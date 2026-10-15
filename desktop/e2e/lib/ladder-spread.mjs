// Which ladder fixtures flip between model draws (e2e/ladder-spread.json, measured by `npm run ladder-score -- --spread`), the "noisy (k/n)" label, and the noisy/steady split of the score's wrong-confident list.
// One draw per fixture is noisy: a jump made only of known-flipping fixtures is noise, a jump on a steady one is real. Never read by the ratchet gate (it replays stored answers). Guard: test/ladder-spread.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashOf} from './ladder-fingerprint.mjs';

export const SPREAD_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ladder-spread.json');
export const DRAWS = 3;
export const readSpread = (file = SPREAD_FILE) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {schemaVersion: 1, fixtures: {}}; } };
// One line per fixture (about 155 lines), sorted, so a re-measure diffs by fixture.
export const writeSpread = (fixtures, file = SPREAD_FILE) => fs.writeFileSync(file, `{\n "schemaVersion": 1,\n "fixtures": {\n${Object.keys(fixtures).sort().map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(fixtures[id])}`).join(',\n')}\n }\n}\n`);

// One key for the whole prompt set (the fingerprints of every rung), so an entry says which prompts it was measured on.
export const fingerprintKey = prints => hashOf(Object.keys(prints).sort().map(key => `${key}=${prints[key]}`));

// The stored outcome vs the draws' rows -> the entry kept per fixture.
export const measureEntry = (storedOutcome, drawRows, fp) => ({draws: drawRows.length, same: drawRows.filter(row => row.outcome === storedOutcome).length, wrongConfident: drawRows.some(row => row.status === 'wrong-confident'), fp});
export const flips = entry => !!entry && entry.same < entry.draws;

// '' for a steady or unmeasured fixture; an older fingerprint's spread is still shown, and says so.
export function labelOf(id, spread, fp) {
  const entry = spread?.fixtures?.[id];
  if (!flips(entry)) return '';
  return `noisy (${entry.same}/${entry.draws}${entry.fp === fp ? '' : ', spread from the previous prompt'})`;
}

export function splitNoisy(rows, spread, fp) {
  const noisy = rows.filter(row => labelOf(row.id, spread, fp)), steady = rows.filter(row => !labelOf(row.id, spread, fp));
  return {noisy, steady};
}

// Lines for the score's summary: the wrong-confident rows that are new against the baseline, split by whether they are known to flip.
export function summaryLines(rows, spread, baseline, fp) {
  const fresh = rows.filter(row => row.status === 'wrong-confident' && baseline?.fixtures?.[row.id]?.status !== 'wrong-confident');
  if (!fresh.length) return [];
  const {noisy, steady} = splitNoisy(fresh, spread, fp);
  const lines = [`Of the ${fresh.length} new wrong-confident, ${noisy.length} are known to flip between draws: ${noisy.map(row => `${row.id} ${labelOf(row.id, spread, fp)}`).join('; ') || '-'}`];
  lines.push(steady.length ? `  steady (a real change): ${steady.map(row => row.id).join(', ')}` : '  all known to flip: this is noise, not a change of the prompt');
  return lines;
}
