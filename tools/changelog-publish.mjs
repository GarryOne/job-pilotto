#!/usr/bin/env node
// Publishes the What's new entry of every released app version by itself (owner, 18 Oct 2026; changelog-publish.yml: when a release run ends, hourly as backup). A version is a stable release or a build the beta gate approved
// ("Beta-approved:" in its notes); the entry covers the commits since the previous such version, so a stable rolls up the builds in between. The AI (Haiku, DIGEST_ANTHROPIC_KEY) sorts them into new features / improvements /
// bug fixes in plain words; site/src/changelog.js checks the answer, the site checks it again (PUT /changelog/data, SELFHEAL_PUBLISH_KEY). A version whose draft fails stays unpublished and is retried at the next run.
//   node tools/changelog-publish.mjs [--dry [--tag desktop-v0.7.28]] [--cost cost.json]    --cost: {usd, calls} for desktop/e2e/ai-cost-report.mjs --job changelog-publish; --dry drafts and prints, publishes nothing. Guard: site/test/changelog-publish.test.js (fake model, fake site).
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {MODEL, ask} from '../site/src/build-digest.js';
import {MODEL_PROMPT, cleanGroups, problems, versionOf} from '../site/src/changelog.js';
import {usageCost} from '../desktop/e2e/lib/vision.mjs';

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const base = process.env.CHANGELOG_URL || 'https://www.jobpilotto.top/changelog/data';
const PATHS = ['desktop', 'src', 'config', 'tools', 'extension', 'worker/src', 'requirements.txt'];   // keep in sync with desktop/scripts/release-notes.sh
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

export async function draftEntry({tag, prev, first, version, date, channel}, {subjects, key, fetch: doFetch}) {
  if (!subjects.length) return {hidden: true, cost: 0, dropped: []};
  const user = `Version ${version} (changes since ${first ? 'the start of the project' : versionOf(prev)}):\n${subjects.map(line => `- ${line}`).join('\n')}`;
  const usage = {input_tokens: 0, output_tokens: 0};
  let failure = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const {text, usage: used, stopReason} = await ask({system: MODEL_PROMPT, user}, {key, fetch: doFetch});
    usage.input_tokens += used.input_tokens || 0; usage.output_tokens += used.output_tokens || 0;
    const cleaned = stopReason === 'max_tokens' ? {error: 'cut off'} : cleanGroups(text);
    if (cleaned.error) { failure = cleaned.error; continue; }
    const cost = usageCost(MODEL, usage) ?? 0;
    if (!cleaned.groups.length) return {hidden: true, cost, dropped: cleaned.dropped};
    const entry = {version, date, channel, groups: cleaned.groups}, bad = problems(entry);
    if (bad.length) throw new Error(`${version}: the entry broke a rule (${bad.join(', ')})`);
    return {entry, cost, dropped: cleaned.dropped};
  }
  throw new Error(`${version}: the model's answer was unusable twice (${failure})`);
}

const rootOf = () => { const sha = out('git', 'rev-list', '--max-parents=0', 'HEAD').split('\n').pop(); return {sha, date: out('git', 'log', '-1', '--format=%as', sha)}; };
const subjectsOf = ({tag, prev}) => out('git', 'log', '--no-merges', '--format=%s', `${prev}..${tag}`, '--', ...PATHS).split('\n').filter(Boolean).slice(0, 150);
const siteCall = async (method, body, key) => {
  const response = await fetch(base, {method, headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(`the site answered ${response.status} to ${method} /changelog/data: ${(await response.text()).slice(0, 300)}`);
  return response.json();
};

async function main() {
  const dry = process.argv.includes('--dry'), aiKey = process.env.DIGEST_ANTHROPIC_KEY, siteKey = process.env.SELFHEAL_PUBLISH_KEY;
  if (!aiKey) { console.error('::error::DIGEST_ANTHROPIC_KEY is not set: nothing drafted.'); process.exit(1); }
  if (!dry && !siteKey) { console.error('::error::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); process.exit(1); }
  const releases = JSON.parse(out('gh', 'release', 'list', '-R', repo, '-L', '200', '--json', 'tagName,isPrerelease,isDraft,publishedAt'));
  for (const item of releases.filter(release => release.isPrerelease)) item.body = JSON.parse(out('gh', 'release', 'view', item.tagName, '-R', repo, '--json', 'body')).body;
  const have = dry ? {} : (await siteCall('GET', null, siteKey)).have;
  const root = rootOf();
  let {draft, promote} = plan(releases, have, root.sha);
  if (arg('tag')) draft = plan(releases, {}, root.sha).draft.filter(item => item.tag === arg('tag'));
  const entries = [], hidden = [], failures = [];
  if (!arg('tag') && !('0.0.1' in have)) entries.push(startEntry(root.date));
  let spent = 0, calls = 0;
  for (const work of draft) {
    try {
      const done = await draftEntry(work, {subjects: subjectsOf(work), key: aiKey});
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
