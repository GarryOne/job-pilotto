// Splits the recorded cases across the CI matrix's jobs (.github/workflows/recorded-pages.yml): JP_REPLAY_SHARD="i/n" runs the i-th of n slices.
// Balanced by what a case costs (a case with only "must not happen" checks waits its whole window), every case in exactly one slice. Guard: e2e/test/replay-shard.test.mjs.
const POSITIVE = ['told', 'filled', 'attached', 'judged', 'asked', 'pressed', 'gone'];
export const caseCost = item => (POSITIVE.some(kind => (item.expect?.[kind] || []).length) ? 0.3 : 1) * (item.expect?.seconds || 40);   // a case with a positive check usually ends early

// "2/4" -> {index: 2, count: 4}; "" -> null (the whole set); anything else throws.
export function parseShard(spec) {
  if (!spec) return null;
  const match = /^(\d+)\/(\d+)$/.exec(String(spec));
  const index = match ? Number(match[1]) : 0, count = match ? Number(match[2]) : 0;
  if (!match || count < 1 || index < 1 || index > count) throw new Error(`replay shard "${spec}": expected i/n with 1 <= i <= n`);
  return {index, count};
}

// Greedy: the costliest case first into the lightest slice. -> the cases of slice `index` (1-based) of `count`.
export function shardOf(items, index, count) {
  const slices = Array.from({length: count}, () => ({cost: 0, items: []}));
  for (const item of [...items].sort((a, b) => caseCost(b) - caseCost(a) || a.name.localeCompare(b.name))) {
    const lightest = slices.reduce((best, slice) => (slice.cost < best.cost ? slice : best));
    lightest.items.push(item); lightest.cost += caseCost(item);
  }
  return slices[index - 1].items;
}
