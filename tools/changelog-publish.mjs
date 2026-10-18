#!/usr/bin/env node
// Publishes the What's new entry of every released app version by itself (owner, 18 Oct 2026; changelog-publish.yml: when a release run ends, hourly as backup). A version is a stable release or a build the beta gate approved
// ("Beta-approved:" in its notes); the entry covers the commits since the previous such version, so a stable rolls up the builds in between. The AI (Haiku, DIGEST_ANTHROPIC_KEY) sorts them into new features / improvements /
// bug fixes in plain words; site/src/changelog.js checks the answer, the site checks it again (PUT /changelog/data, SELFHEAL_PUBLISH_KEY). A version whose draft fails stays unpublished and is retried at the next run.
//   node tools/changelog-publish.mjs [--plan] [--backfill] [--dry [--tag desktop-v0.7.28]] [--cost cost.json]   --plan: $0 table of what a run would read and cost; --backfill: also drafts versions older than the newest stored one and the 0.0.1 entry (an automatic run does neither);    --cost: {usd, calls} for desktop/e2e/ai-cost-report.mjs --job changelog-publish; --dry drafts and prints, publishes nothing. Guard: site/test/changelog-publish.test.js (fake model, fake site).
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {MODEL, ask} from '../site/src/build-digest.js';
import {MERGE_PROMPT, MODEL_PROMPT, cleanGroups, problems, versionOf} from '../site/src/changelog.js';
import {usageCost} from '../desktop/e2e/lib/vision.mjs';

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const base = process.env.CHANGELOG_URL || 'https://www.jobpilotto.top/changelog/data';
// Only what a user can see reaches the AI (owner, 18 Oct 2026: "I have 5000 commits, be careful"): a commit that touches only tests, e2e, fixtures, recordings, scripts, docs, tools or CI is not read at all.
export const PATHSPEC = ['desktop', 'src', 'config', 'extension', 'worker/src', 'requirements.txt', ':(exclude)desktop/e2e', ':(exclude)desktop/test', ':(exclude)desktop/scripts', ':(exclude)desktop/docs',
  ':(exclude,glob)**/fixtures/**', ':(exclude,glob)**/test/**', ':(exclude,glob)**/tests/**', ':(exclude,glob)**/recorded*/**'];
const OLD_PATHS = ['desktop', 'src', 'config', 'tools', 'extension', 'worker/src', 'requirements.txt'];   // what the page read before the filter, only for the dry run's "before" count
const CHUNK = 300, CAP = 0.15;   // subjects per AI call; the run stops past this many dollars
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? '' : ''; };
const out = (cmd, ...args) => execFileSync(cmd, args, {encoding: 'utf8', maxBuffer: 1 << 26}).trim();
const order = version => versionOf(version).replace(/-alpha\.\d+$/, '').split('.').map(Number);   // 0.4.0-alpha.254 sorts as 0.4.0
const byVersion = (a, b) => { const x = order(a.tagName), y = order(b.tagName); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); };

// GitHub releases [{tagName, isPrerelease, isDraft, publishedAt, body}] + what the site has ({version: channel}) -> the work, oldest first:
//   {tag, prev, version, date, channel} to draft, {version, channel: 'stable'} to promote a stored beta. The oldest release is "since" the first commit (`root`, a sha), so the page starts at the project's start (backfill 18 Oct 2026).
export function plan(releases, have = {}, root = '') {
  const published = releases.filter(item => /^desktop-v\d+\.\d+\.\d+(-alpha\.\d+)?$/.test(item.tagName) && !item.isDraft && (!item.isPrerelease || /^Beta-approved/m.test(item.body || ''))).sort(byVersion);
  const draft = [], promote = [];
  published.forEach((item, at) => {
    const version = order(item.tagName).join('.'), channel = item.isPrerelease ? 'beta' : 'stable';
    if (at === 0 && !root) return;
    if (!(version in have)) draft.push({tag: item.tagName, prev: at ? published[at - 1].tagName : root, first: at === 0, version, date: item.publishedAt.slice(0, 10), channel});
    else if (have[version] === 'beta' && channel === 'stable') promote.push({version, channel});
  });
  return {draft, promote};
}

// One version -> {entry} or {hidden: true} (nothing a user would notice) and its cost; throws when the AI's answer is unusable (nothing is published for it).
// The 0.0.1 entry: the project start, dated at the first commit. Fixed words (checked by problems() like any entry), no AI call.
export const startEntry = date => ({version: '0.0.1', date, channel: 'start', groups: [{kind: 'features', items: [{emoji: '🌱', lead: 'Job Pilotto begins', text: 'The very first version finds job openings in Switzerland and sends you a daily list.'}]}]});

// An automatic run drafts only versions NEWER than the newest stored one (a missing older version is a backfill: explicit --backfill, owner 18 Oct 2026).
export const newerThanStored = (draft, have) => {
  const compare = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
  const top = Object.keys(have).map(order).sort((x, y) => compare(y, x))[0];
  return top ? draft.filter(item => compare(order(item.version), top) > 0) : draft;
};

export const chunksOf = (subjects, size = CHUNK) => Array.from({length: Math.ceil(subjects.length / size)}, (_, i) => subjects.slice(i * size, (i + 1) * size));

// $0 estimate for the dry run: chunks, tokens in/out and cost, from the subject text (about 4 characters a token; an answer ~200 + 60 tokens per subject, up to 2,400; one merge call over 1 chunk).
export function estimate(subjects) {
  const parts = chunksOf(subjects);
  if (!parts.length) return {chunks: 0, tokensIn: 0, tokensOut: 0, cost: 0};
  const tokensIn = parts.reduce((sum, part) => sum + Math.ceil((MODEL_PROMPT.length + part.join('\n').length + part.length * 3) / 4), 0) + (parts.length > 1 ? Math.ceil(MERGE_PROMPT.length / 4) + parts.length * 400 : 0);
  const tokensOut = parts.reduce((sum, part) => sum + Math.min(2400, 200 + 60 * part.length), 0) + (parts.length > 1 ? 2400 : 0);   // a full answer (18 items) is ~2,000 tokens; measured 18 Oct 2026
  return {chunks: parts.length, tokensIn, tokensOut, cost: 1.3 * (usageCost(MODEL, {input_tokens: tokensIn, output_tokens: tokensOut}) ?? 0)};   // x1.3: some answers are asked twice (cut off, unusable)
}

// One AI call that must answer a checked group list (retried once). Adds its cost to `spend`; never starts a call past the cap.
async function groupsFrom(system, user, {key, fetch: doFetch, spend}) {
  let failure = '', dropped = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (spend && spend.total >= spend.cap) throw new Error(`the spend cap of $${spend.cap} is reached`);
    const {text, usage, stopReason} = await ask({system, user}, {key, fetch: doFetch});
    if (spend) spend.total += usageCost(MODEL, usage) ?? 0;
    const cleaned = stopReason === 'max_tokens' ? {error: 'cut off'} : cleanGroups(text);
    if (cleaned.error) { failure = cleaned.error; continue; }
    return {groups: cleaned.groups, dropped: cleaned.dropped};
  }
  return {failure, groups: null, dropped};
}
const lineOf = (group, item) => `- [${group.kind}] ${item.lead}: ${item.text}`;
const union = parts => ['features', 'improvements', 'fixes'].map(kind => ({kind, items: parts.flatMap(groups => groups.filter(group => group.kind === kind).flatMap(group => group.items)).slice(0, 6)})).filter(group => group.items.length);

// One version -> {entry} or {hidden: true} (nothing a user would notice) and its cost; throws when the AI's answer is unusable (nothing is published for it).
// More than CHUNK subjects are read in parts (one call each), then ONE short call joins the parts; a join that fails keeps the parts' own notes, at most 6 per kind.
export async function draftEntry({tag, prev, first, version, date, channel}, {subjects, key, fetch: doFetch, spend = {total: 0, cap: Infinity}}) {
  if (!subjects.length) return {hidden: true, cost: 0, dropped: []};
  const start = spend.total, parts = chunksOf(subjects), since = first ? 'the start of the project' : versionOf(prev), results = [], dropped = [];
  for (const [at, part] of parts.entries()) {
    const user = `Version ${version} (changes since ${since}${parts.length > 1 ? `, part ${at + 1} of ${parts.length}` : ''}):\n${part.map(line => `- ${line}`).join('\n')}`;
    const done = await groupsFrom(MODEL_PROMPT, user, {key, fetch: doFetch, spend});
    if (!done.groups) throw new Error(`${version}: the model's answer was unusable twice (${done.failure})`);
    results.push(done.groups); dropped.push(...done.dropped);
  }
  let groups = results.length === 1 ? results[0] : union(results);
  if (results.length > 1 && groups.length) {
    const lines = results.flatMap(parts => parts.flatMap(group => group.items.map(item => lineOf(group, item)))).join('\n');
    const joined = await groupsFrom(MERGE_PROMPT, `Version ${version}:\n${lines}`, {key, fetch: doFetch, spend});
    if (joined.groups?.length) groups = joined.groups;
    dropped.push(...joined.dropped);
  }
  const cost = spend.total - start;
  if (!groups.length) return {hidden: true, cost, dropped};
  const entry = {version, date, channel, groups}, bad = problems(entry);
  if (bad.length) throw new Error(`${version}: the entry broke a rule (${bad.join(', ')})`);
  return {entry, cost, dropped};
}

const rootOf = () => { const sha = out('git', 'rev-list', '--max-parents=0', 'HEAD').split('\n').pop(); return {sha, date: out('git', 'log', '-1', '--format=%as', sha)}; };
const subjectsOf = ({tag, prev}, paths = PATHSPEC) => out('git', 'log', '--no-merges', '--format=%s', `${prev}..${tag}`, '--', ...paths).split('\n').filter(Boolean);
const siteCall = async (method, body, key) => {
  const response = await fetch(base, {method, headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(`the site answered ${response.status} to ${method} /changelog/data: ${(await response.text()).slice(0, 300)}`);
  return response.json();
};

// $0: per version the commits before and after the filter, the chunks, the estimated tokens and cost. No AI key, no site call.
function printPlan(draft, root) {
  let total = 0;
  console.log('version | date | commits before filter | after | chunks | tokens in | tokens out | est. $');
  for (const work of draft) {
    const before = subjectsOf(work, OLD_PATHS).length, subjects = subjectsOf(work), {chunks, tokensIn, tokensOut, cost} = estimate(subjects);
    total += cost;
    console.log(`${work.version} | ${work.date} | ${before} | ${subjects.length} | ${chunks} | ${tokensIn} | ${tokensOut} | $${cost.toFixed(4)}`);
  }
  console.log(`${draft.length} versions + the 0.0.1 start entry (${root.date}, no AI); estimated total $${total.toFixed(4)}; hard stop at $${CAP}`);
}

async function main() {
  const dry = process.argv.includes('--dry'), backfill = process.argv.includes('--backfill'), planOnly = process.argv.includes('--plan'), aiKey = process.env.DIGEST_ANTHROPIC_KEY, siteKey = process.env.SELFHEAL_PUBLISH_KEY;
  if (!aiKey && !planOnly) { console.error('::error::DIGEST_ANTHROPIC_KEY is not set: nothing drafted.'); process.exit(1); }
  if (!dry && !planOnly && !siteKey) { console.error('::error::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); process.exit(1); }
  const releases = JSON.parse(out('gh', 'release', 'list', '-R', repo, '-L', '200', '--json', 'tagName,isPrerelease,isDraft,publishedAt'));
  for (const item of releases.filter(release => release.isPrerelease)) item.body = JSON.parse(out('gh', 'release', 'view', item.tagName, '-R', repo, '--json', 'body')).body;
  const have = planOnly && !siteKey ? {'0.7.16': 'stable'} : dry ? {} :   // --plan without the site key: 0.7.16 is the one version stored today
     (await siteCall('GET', null, siteKey)).have;
  const root = rootOf();
  let {draft, promote} = plan(releases, have, root.sha);
  if (arg('tag')) draft = plan(releases, {}, root.sha).draft.filter(item => item.tag === arg('tag'));
  else if (!backfill) draft = newerThanStored(draft, have);
  if (process.argv.includes('--plan')) return printPlan(draft, root);
  const entries = [], hidden = [], failures = [];
  if (backfill && !arg('tag') && !('0.0.1' in have)) entries.push(startEntry(root.date));
  const spend = {total: 0, cap: CAP};
  let spent = 0, calls = 0;
  for (const work of draft) {
    if (spend.total >= spend.cap) { console.log(`::error::the spend cap of $${CAP} is reached: stopping, ${work.version} and the versions after it are not drafted`); failures.push('spend cap'); break; }
    try {
      const done = await draftEntry(work, {subjects: subjectsOf(work), key: aiKey, spend});
      spent += done.cost; calls += done.cost > 0 ? 1 : 0;
      console.log(`${work.tag}: ${done.entry ? `${done.entry.groups.map(group => `${group.kind} ${group.items.length}`).join(', ')}` : 'nothing a user would notice (hidden)'}, ${done.dropped.length} dropped by the word floor, $${done.cost.toFixed(4)}`);
      for (const line of done.dropped) console.log(`  dropped: ${line}`);
      if (done.entry) entries.push(done.entry); else hidden.push({version: work.version, date: work.date, channel: work.channel});
      if (dry) console.log(JSON.stringify(done.entry || {hidden: true}, null, 2));
    } catch (error) { failures.push(error.message); console.log(`::error::${error.message} (not published; retried at the next run)`); }
  }
  if (!dry && (entries.length || hidden.length || promote.length)) {
    const result = await siteCall('PUT', {entries, hidden, channels: Object.fromEntries(promote.map(item => [item.version, item.channel]))}, siteKey);
    console.log(`published: ${result.stored} entries, ${result.hidden} hidden, ${promote.length} promoted to stable; AI cost $${spent.toFixed(4)}`);
  } else console.log(`nothing to publish${dry ? ' (dry run)' : ''}; AI cost $${spent.toFixed(4)}`);
  if (arg('cost')) writeFileSync(arg('cost'), JSON.stringify({usd: spent, calls}));
  if (failures.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
