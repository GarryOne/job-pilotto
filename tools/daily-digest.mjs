#!/usr/bin/env node
// Writes the daily build digest ("what we built today", spec docs/superpowers/specs/2026-10-16-daily-digest.md) from the PRs merged on one Zurich day, with Haiku (site/src/build-digest.js does the cutting, validating and rendering).
//   node tools/daily-digest.mjs [--day YYYY-MM-DD] [--out digest.json] [--cost cost.json] [--prs prs.json --open open.json]
// Needs gh with GH_TOKEN (unless --prs) and DIGEST_ANTHROPIC_KEY (the Self-heal workspace key; a missing key fails loudly, no fallback). --out: {day, markdown, groups, open, numbers, usd}; --cost: {usd, calls} for desktop/e2e/ai-cost-report.mjs --job daily-digest --file.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {MODEL, countOf, makeDigest, zurichDay} from '../site/src/build-digest.js';
import {usageCost} from '../desktop/e2e/lib/vision.mjs';

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 28}) || 'null');
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : ''; };

// The PRs merged on `day` (Zurich) and the open ones. gh's search is by UTC date: ask for the day before too, then keep the exact Zurich day.
export function collect(day) {
  const before = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const merged = gh('pr', 'list', '--repo', repo, '--state', 'merged', '--search', `merged:>=${before}`, '--limit', '400', '--json', 'number,title,mergedAt,body')
    .filter(pr => zurichDay(new Date(pr.mergedAt)) === day);
  const open = gh('pr', 'list', '--repo', repo, '--state', 'open', '--limit', '40', '--json', 'number,title');
  return {prs: merged.sort((a, b) => a.number - b.number), open};
}

async function main() {
  const key = process.env.DIGEST_ANTHROPIC_KEY, day = arg('day') || zurichDay(new Date());
  if (!key) { console.error('::error::DIGEST_ANTHROPIC_KEY is not set (the Self-heal workspace key): no digest written.'); process.exit(1); }
  const given = arg('prs'), {prs, open} = given ? {prs: JSON.parse(readFileSync(given, 'utf8')), open: arg('open') ? JSON.parse(readFileSync(arg('open'), 'utf8')) : []} : collect(day);
  const digest = await makeDigest({day, prs, open, key});
  const usd = usageCost(MODEL, digest.usage) ?? 0, {count, min, max} = countOf(digest.numbers);
  console.log(`${day}: ${count} PRs${count ? ` (#${min}-#${max})` : ''}, ${digest.groups.length} groups, $${usd.toFixed(4)}`);
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify({day, markdown: digest.markdown, groups: digest.groups, open: digest.open, numbers: digest.numbers, usd}));
  if (arg('cost')) writeFileSync(arg('cost'), JSON.stringify({usd, calls: digest.numbers.length ? 1 : 0}));
  if (!arg('out')) console.log(digest.markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
