#!/usr/bin/env node
// `npm run widget-zoo`: replays every widget-zoo page (e2e/widget-zoo/) with the real extension, offline, and prints per page whether the fill READ the question and whether the value
// stayed COMMITTED, then the totals per widget. A measure: a miss never fails the run (exit 1 only when the replay itself broke, or a page pressed a submit). --json <file> writes the
// verdicts; REPLAY_ONLY=<part of a name> runs those pages. Lib: lib/widget-zoo.mjs. CI: .github/workflows/widget-zoo.yml (not a required check).
import fs from 'node:fs';
import {replayInTabs} from './lib/replay-browser.mjs';
import {loadZoo, summarizeZoo, verdictOf} from './lib/widget-zoo.mjs';

const args = process.argv.slice(2), jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
const cases = loadZoo().filter(one => one.name.includes(process.env.REPLAY_ONLY || ''));
const results = await replayInTabs(cases, {tabs: Math.max(1, Number(process.env.JP_REPLAY_TABS || 3)), extensionDir: process.env.REAL_EXTENSION_DIR || undefined});
const verdicts = cases.map((item, index) => verdictOf(item, results[index]));
const summary = summarizeZoo(verdicts);

const pad = (text, width) => String(text).padEnd(width).slice(0, width);
console.log(`widget zoo: ${summary.total} pages, read ${summary.read}, committed ${summary.committed}`);
for (const one of verdicts) console.log(`  ${pad(one.name, 26)} ${pad(one.widget, 19)} read ${one.read ? 'yes' : 'NO '}  committed ${one.committed ? 'yes' : 'NO '}${one.failures.length ? `  (${one.failures.join('; ').slice(0, 160)})` : ''}`);
console.log('Per widget (committed / pages):');
for (const [widget, entry] of Object.entries(summary.byWidget)) console.log(`  ${pad(widget, 19)} ${entry.committed}/${entry.total}`);
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify({summary, verdicts}, null, 1)}\n`);
const broken = verdicts.filter(one => one.failures.some(line => /^(error|isolation)\b/.test(line)));
if (summary.unsafe.length) console.error(`UNSAFE: a submit was pressed on ${summary.unsafe.join(', ')}`);
if (broken.length) console.error(`replay broke on ${broken.map(one => one.name).join(', ')}`);
process.exit(summary.unsafe.length || broken.length ? 1 : 0);
