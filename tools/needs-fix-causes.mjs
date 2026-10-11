#!/usr/bin/env node
// Prints the "Needs a fix" rows grouped by cause, as /admin/applying's "By cause" tab does (site/src/applying-groups.js: the page embeds the same function, so they cannot disagree):
// "Run first" (never run, or the last run is older than a fix landed for that row: a pool run, not a fix), one group per top cause, then the rows with no cause recorded.
// Reads the owner page's data with the Keychain key job-pilotto.site.api_key (never printed). Read-only: one GET.
// Usage: node tools/needs-fix-causes.mjs [--rows] [--json <file>]   (--rows lists the shapes under each group; --json reads a saved copy of the page's ?json)
// Columns: cause, rows, claimed (rows a session holds; the session itself is never on the site), oldest run. Guard: site/test/needs-fix-causes.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {needsFixGroups} from '../site/src/applying-groups.js';

const SITE = 'https://www.jobpilotto.top/admin/applying?json';

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

function fetchJson() {
  const key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();   // never printed
  return JSON.parse(execFileSync('curl', ['-s', '--fail', '--max-time', '30', '-H', `Authorization: Bearer ${key}`, SITE], {encoding: 'utf8', maxBuffer: 64 << 20}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--json');
  try { console.log(groupLines(at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : fetchJson(), {rows: process.argv.includes('--rows')}).join('\n')); } catch (error) { console.error('needs-fix-causes: ' + String(error?.message || error).split('\n')[0]); process.exit(1); }
}
