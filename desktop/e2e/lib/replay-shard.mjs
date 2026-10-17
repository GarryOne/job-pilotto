// Splits the recorded cases across the CI matrix's jobs (.github/workflows/page-cases.yml): JP_REPLAY_SHARD="i/n" runs the i-th of n slices.
// Balanced by what a case costs on a pull request: its measured seconds (case-seconds.json, written by tools/slow-page-cases.mjs from a quick-window run of every case), else its declared window
// (a case with only "must not happen" checks waits its whole window); every case in exactly one slice. Guard: e2e/test/replay-shard.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const POSITIVE = ['told', 'filled', 'attached', 'judged', 'asked', 'pressed', 'gone'];
export const caseCost = item => (POSITIVE.some(kind => (item.expect?.[kind] || []).length) ? 0.3 : 1) * (item.expect?.seconds || 40);   // a case with a positive check usually ends early

export const SECONDS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'case-seconds.json');
export const MISSING_SECONDS = 25;   // a case the measured run lacks (it was re-run alone, so its seconds were not kept): about what a typical case costs on a PR
export const readSeconds = (file = SECONDS_FILE) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).seconds || {}; } catch { return {}; } };
export const costOf = (item, seconds = {}) => (Object.keys(seconds).length ? seconds[item.name] ?? MISSING_SECONDS : caseCost(item));

// "2/4" -> {index: 2, count: 4}; "" -> null (the whole set); anything else throws.
export function parseShard(spec) {
  if (!spec) return null;
  const match = /^(\d+)\/(\d+)$/.exec(String(spec));
  const index = match ? Number(match[1]) : 0, count = match ? Number(match[2]) : 0;
  if (!match || count < 1 || index < 1 || index > count) throw new Error(`replay shard "${spec}": expected i/n with 1 <= i <= n`);
  return {index, count};
}

// Greedy: the costliest case first into the lightest slice. -> the cases of slice `index` (1-based) of `count`.
export function shardOf(items, index, count, seconds = readSeconds()) {
  const slices = Array.from({length: count}, () => ({cost: 0, items: []}));
  for (const item of [...items].sort((a, b) => costOf(b, seconds) - costOf(a, seconds) || a.name.localeCompare(b.name))) {
    const lightest = slices.reduce((best, slice) => (slice.cost < best.cost ? slice : best));
    lightest.items.push(item); lightest.cost += costOf(item, seconds);
  }
  return slices[index - 1].items;
}
