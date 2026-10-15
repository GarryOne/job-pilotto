#!/usr/bin/env node
// Prints the "Needs a fix" rows grouped by cause, as /admin/lab-form-filling's "By cause" tab does (site/src/applying-groups.js: the page embeds the same function, so they cannot disagree):
// "Run first" (never run, or the last run is older than a fix landed for that row: a pool run, not a fix), one group per top cause, then the rows with no cause recorded.
// Reads the owner page's data with the Keychain key job-pilotto.site.api_key (never printed). Read-only: a saved copy of the page's data at most 15 minutes old (--refresh fetches it again).
// Usage: node tools/needs-fix-causes.mjs [--rows] [--json <file>] [--brief "<cause>" [--note "<one line>"]]   (--brief prints a ready fixer prompt for that cause: tools/fixer-brief.mjs; "Run first" refuses, exit 1)
//   (--rows lists the shapes under each group; --json reads a saved copy of the page's ?json)
// Columns: cause, rows, claimed (rows a session holds; the session itself is never on the site), oldest run. Guard: site/test/needs-fix-causes.test.js.
import fs from 'node:fs';
import {recordVar} from './record-env.mjs';
import {pageJson} from './applying-page-copy.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {needsFixGroups} from '../site/src/applying-groups.js';
import {buildBrief} from './fixer-brief.mjs';


// The groups from the page's ?json.
export const groupsOf = json => needsFixGroups(json.pool || [], json.scorecard || [], json.steps || [], (json.fixed || {}).rows || []);

const when = at => new Date(at).toISOString().slice(0, 16).replace('T', ' ');
export function groupLines(json, {rows = false} = {}) {
  const table = [['cause', 'rows', 'claimed', 'oldest run'], ...groupsOf(json).map(g => [g.label, String(g.count), g.claimed ? g.claimed + ' of ' + g.count : '—',
    g.neverRun ? 'never run' + (g.neverRun < g.count && g.oldest ? ' (+ ' + when(g.oldest) + ')' : '') : g.oldest ? when(g.oldest) : '—'])];
  const width = table[0].map((_, col) => Math.max(...table.map(row => row[col].length)));
  const out = table.map(row => row.map((text, col) => (col === row.length - 1 ? text : text.padEnd(width[col]))).join('  '));
  if (!rows) return out;
  return groupsOf(json).flatMap((g, at) => [out[at + 1], ...g.rows.map(s => '    ' + (s.shape || s.name) + (s.claimed ? '  (claimed)' : ''))]).reduce((all, line) => (all.push(line), all), [out[0]]);
}

const fetchJson = () => pageJson({caller: 'needs-fix-causes', refresh: process.argv.includes('--refresh')});   // the saved copy, at most 15 minutes old (tools/applying-page-copy.mjs)

// The capture folders on this Mac: {<day>: [folder]} under RECORD_CANDIDATES (default: the QA folder's replay-candidates), {} when there are none.
function captureListing() {
  const root = recordVar('CANDIDATES') || path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA', 'replay-candidates'), listing = {};
  try { for (const day of fs.readdirSync(root).filter(name => /^\d{4}-\d\d-\d\d$/.test(name))) listing[day] = fs.readdirSync(path.join(root, day)).filter(folder => fs.existsSync(path.join(root, day, folder, 'case.json'))); } catch { /* none */ }
  return listing;
}
const argOf = flag => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : undefined; };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--json');
  try {
    if (process.argv.includes('--brief')) {
      const json = at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : fetchJson(), brief = buildBrief(groupsOf(json), argOf('--brief'), captureListing(), {oneLine: argOf('--note') || ''});
      (brief.ok ? console.log : console.error)(brief.ok ? brief.text : 'needs-fix-causes: ' + brief.text);
      process.exit(brief.ok ? 0 : 1);
    }
    console.log(groupLines(at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : fetchJson(), {rows: process.argv.includes('--rows')}).join('\n'));
  } catch (error) { console.error('needs-fix-causes: ' + String(error?.message || error).split('\n')[0]); process.exit(1); }
}
