#!/usr/bin/env node
// Prints the "Needs a fix" order of /admin/lab-form-filling, worst first, with the page's own sort (site/src/applying-order.js: the page embeds the same function, so they cannot disagree).
// Reads the owner page's data with the Keychain key job-pilotto.site.api_key (never printed). Read-only: a saved copy of the page's data at most 15 minutes old (--refresh fetches it again).
// Usage: node tools/needs-fix-order.mjs [--json <file>]   (--json reads a saved copy of the page's ?json instead of the site)
// Columns: rank, shape (the pool row's name), platform, reached, filled/left of the last run, claimed (when a session took the shape: its time only, never the session).
// Guard: site/test/needs-fix-order.test.js.
import fs from 'node:fs';
import {pageJson} from './applying-page-copy.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {needsFixOrder} from '../site/src/applying-order.js';


// The sites that need a fix, worst first, from the page's ?json.
export const rankRows = json => needsFixOrder(json.pool || [], json.scorecard || [], json.steps || []).rows;

const cell = value => (value == null || value === '' ? '—' : String(value));
const claimed = at => (at ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') : '—');
export function orderLines(json) {
  const rows = rankRows(json).map((s, i) => [String(i + 1), s.shape || s.name, s.platform, s.reached, Number.isInteger(s.filled) && Number.isInteger(s.left) ? s.filled + '/' + s.left : null, claimed(s.claimed)].map(cell));
  const table = [['rank', 'shape', 'platform', 'reached', 'filled/left', 'claimed'], ...rows], width = table[0].map((_, col) => Math.max(...table.map(row => row[col].length)));
  return table.map(row => row.map((text, col) => (col === row.length - 1 ? text : text.padEnd(width[col]))).join('  '));
}

const fetchJson = () => pageJson({caller: 'needs-fix-order', refresh: process.argv.includes('--refresh')});   // the saved copy, at most 15 minutes old (tools/applying-page-copy.mjs)

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--json');
  try { console.log(orderLines(at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : fetchJson()).join('\n')); } catch (error) { console.error('needs-fix-order: ' + String(error?.message || error).split('\n')[0]); process.exit(1); }
}
