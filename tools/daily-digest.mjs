#!/usr/bin/env node
// Writes the daily build digest ("what we built today", spec docs/superpowers/specs/2026-10-16-daily-digest.md) from the PRs merged on one Zurich day, with Haiku (site/src/build-digest.js does the cutting, validating and rendering).
//   node tools/daily-digest.mjs [--day YYYY-MM-DD] [--force [--final]] [--out results.json] [--cost cost.json] [--prs prs.json --open open.json]
// Hourly (daily-digest.yml): asks the site what it holds (GET /digest/data), plans (build-digest.js plan: unchanged set, once an hour, 8 drafts, final from 23:00 Zurich) and stores the draft (PUT, SELFHEAL_PUBLISH_KEY).
// Needs gh with GH_TOKEN (unless --prs) and DIGEST_ANTHROPIC_KEY (the Self-heal workspace key; a missing key fails loudly, no fallback). --out: a list of {day, final, markdown, groups, open, numbers, usd}; --cost: {usd, calls} for desktop/e2e/ai-cost-report.mjs --job daily-digest --file.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {MODEL, countOf, makeDigest, plan, zurichDay, zurichHour} from '../site/src/build-digest.js';
import {usageCost} from '../desktop/e2e/lib/vision.mjs';

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const base = process.env.DIGEST_URL || 'https://www.jobpilotto.top/digest/data';
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

// One day: look at what the site holds, decide (plan), write the digest, store it. Returns what happened, for the log and for the Telegram step (--out).
async function runDay({day, late, key, publishKey, now}) {
  const {prs, open} = arg('prs') ? {prs: JSON.parse(readFileSync(arg('prs'), 'utf8')), open: arg('open') ? JSON.parse(readFileSync(arg('open'), 'utf8')) : []} : collect(day);
  const numbers = prs.map(pr => pr.number);
  let stored = null;
  if (publishKey && !process.argv.includes('--force')) stored = await (await fetch(`${base}?day=${day}`, {headers: {Authorization: `Bearer ${publishKey}`}})).json();
  const decision = process.argv.includes('--force') ? {final: process.argv.includes('--final')} : plan({now, numbers, stored, late, zurichHour: zurichHour(now)});
  if (decision.skip) { console.log(`${day}: skipped (${decision.skip})`); return null; }
  const digest = await makeDigest({day, prs, open, key});
  const usd = usageCost(MODEL, digest.usage) ?? 0, {count, min, max} = countOf(digest.numbers);
  console.log(`${day}: ${decision.final ? 'FINAL' : 'draft'}, ${count} PRs${count ? ` (#${min}-#${max})` : ''}, ${digest.groups.length} groups, $${usd.toFixed(4)}`);
  const result = {day, final: decision.final, markdown: digest.markdown, groups: digest.groups, open: digest.open, numbers: digest.numbers, usd};
  if (publishKey) {
    const response = await fetch(base, {method: 'PUT', headers: {Authorization: `Bearer ${publishKey}`, 'Content-Type': 'application/json'}, body: JSON.stringify(result)});
    if (!response.ok) throw new Error(`the site refused the digest (${response.status})`);
  } else console.log('(SELFHEAL_PUBLISH_KEY is not set: nothing stored)');
  return result;
}

async function main() {
  const key = process.env.DIGEST_ANTHROPIC_KEY, now = new Date(), results = [];
  if (!key) { console.error('::error::DIGEST_ANTHROPIC_KEY is not set (the Self-heal workspace key): no digest written.'); process.exit(1); }
  const today = arg('day') || zurichDay(now), publishKey = process.env.SELFHEAL_PUBLISH_KEY;
  // Just after midnight the day before is closed first (its final digest), then today starts.
  const days = !arg('day') && zurichHour(now) < 2 ? [{day: zurichDay(new Date(now.getTime() - 3 * 3600000)), late: true}, {day: today}] : [{day: today}];
  for (const item of days) { const result = await runDay({...item, key, publishKey, now}); if (result) results.push(result); }
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(results));
  if (arg('cost')) writeFileSync(arg('cost'), JSON.stringify({usd: results.reduce((sum, item) => sum + item.usd, 0), calls: results.length}));
  if (!arg('out') && !publishKey) for (const item of results) console.log(item.markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
