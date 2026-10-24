// A suite may not copy more of the app's wording than app-words-baseline.json says: the count per suite only falls (lib/app-words.mjs says why and how out).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {copiedWords} from '../lib/app-words.mjs';

const e2e = path.join(import.meta.dirname, '..');
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? (entry.name === 'node_modules' ? [] : walk(path.join(dir, entry.name))) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
const app = ['renderer', 'lib'].flatMap(dir => walk(path.join(e2e, '..', dir))).map(file => fs.readFileSync(file, 'utf8')).join('\n');
const baseline = JSON.parse(fs.readFileSync(path.join(e2e, 'app-words-baseline.json'), 'utf8'));

test('copiedWords finds prose a suite quotes from the app, not short words, code or words the app does not say', () => {
  const suite = "await expect('Backup saved to the folder'); x('ok'); y('const a = b'); z('A line the app never says')";
  assert.deepEqual(copiedWords(suite, 'toast("Backup saved to the folder")'), ['Backup saved to the folder']);
});

test('no suite copies more of the app\'s words than its baseline (read the name from the app, a role or a test id instead)', () => {
  const over = [];
  for (const file of fs.readdirSync(path.join(e2e, 'suites')).filter(name => name.endsWith('.mjs'))) {
    const suite = file.replace('.mjs', '');
    const words = copiedWords(fs.readFileSync(path.join(e2e, 'suites', file), 'utf8'), app);
    if (words.length > (baseline[suite] || 0)) over.push(`${suite}: ${words.length} copied words, baseline ${baseline[suite] || 0}: ${words.slice(0, 3).join(' | ')}`);
  }
  assert.deepEqual(over, [], 'a suite quotes the app\'s own words; use a role, a test id or a pattern the app exports, or (if it is truly needed) raise the baseline in the PR and say why');
});
