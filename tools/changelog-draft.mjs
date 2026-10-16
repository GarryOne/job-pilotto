#!/usr/bin/env node
// Drafts the public changelog entry of one STABLE app version for the owner to approve (spec docs/superpowers/specs/2026-10-16-daily-digest.md §6). It never publishes:
//   node tools/changelog-draft.mjs [--tag desktop-v0.7.16] [--out draft.json]     draft (needs gh, git history, DIGEST_ANTHROPIC_KEY); the entry is {version, date, items}
//   node tools/changelog-draft.mjs --add draft.json                              after the owner's yes: put an approved draft into site/public/changelog.json (re-checked, newest first)
// The commits are the subjects between the previous stable tag and this one that touch what the app ships (the paths of desktop/scripts/release-notes.sh).
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {MODEL, ask} from '../site/src/build-digest.js';
import {MODEL_PROMPT, addEntry, cleanItems, versionOf} from '../site/src/changelog.js';
import {usageCost} from '../desktop/e2e/lib/vision.mjs';

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const FILE = new URL('../site/public/changelog.json', import.meta.url);
const PATHS = ['desktop', 'src', 'config', 'tools', 'extension', 'worker/src', 'requirements.txt'];   // keep in sync with desktop/scripts/release-notes.sh
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : ''; };
const out = (cmd, ...args) => execFileSync(cmd, args, {encoding: 'utf8', maxBuffer: 1 << 26}).trim();

// The stable desktop tags, newest first.
export const stableTags = () => JSON.parse(out('gh', 'release', 'list', '-R', repo, '-L', '100', '--json', 'tagName,isPrerelease,publishedAt'))
  .filter(item => /^desktop-v\d+\.\d+\.\d+$/.test(item.tagName) && !item.isPrerelease).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

async function draft() {
  const key = process.env.DIGEST_ANTHROPIC_KEY;
  if (!key) { console.error('::error::DIGEST_ANTHROPIC_KEY is not set: no draft written.'); process.exit(1); }
  const stable = stableTags(), tag = arg('tag') || stable[0].tagName, at = stable.findIndex(item => item.tagName === tag);
  if (at < 0 || !stable[at + 1]) { console.error(`${tag} is not a stable tag with an earlier stable tag.`); process.exit(1); }
  const prev = stable[at + 1].tagName;
  const subjects = out('git', 'log', '--no-merges', '--format=%s', `${prev}..${tag}`, '--', ...PATHS).split('\n').filter(Boolean).slice(0, 150);
  const {text, usage} = await ask({system: MODEL_PROMPT, user: `Version ${versionOf(tag)} (changes since ${versionOf(prev)}):\n${subjects.map(line => `- ${line}`).join('\n')}`}, {key});
  const cleaned = cleanItems(text);
  if (cleaned.error) throw new Error(`the model's answer was unusable (${cleaned.error})`);
  const entry = {version: versionOf(tag), date: stable[at].publishedAt.slice(0, 10), items: cleaned.items};
  console.log(`${tag}: ${subjects.length} commits, ${entry.items.length} user-visible items, ${cleaned.dropped.length} dropped by the word floor, $${(usageCost(MODEL, usage) ?? 0).toFixed(4)}`);
  for (const line of cleaned.dropped) console.log(`  dropped: ${line}`);
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(entry, null, 2)); else console.log(JSON.stringify(entry, null, 2));
}

function add(path) {
  const list = JSON.parse(readFileSync(FILE, 'utf8')), next = addEntry(list, JSON.parse(readFileSync(path, 'utf8')));
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`site/public/changelog.json now lists ${next.map(item => item.version).join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) (arg('add') ? Promise.resolve(add(arg('add'))) : draft()).catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
