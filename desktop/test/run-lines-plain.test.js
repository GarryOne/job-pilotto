// Every engine line a run card's log can show reads as plain words: no regex or code, no "(s)" plural, no file or snake_case names (owner, 18 Oct 2026: "Broken writing").
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readableLog} from '../renderer/human-log.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const files = dir => readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : name.endsWith('.py') ? [join(dir, name)] : []));
// What a person must never read in a run's line: a regex piece, "(s)", a file name, a snake_case name.
const CODE = [[/\(e?s\)/, '"(s)" plural'], [/\\[bBdDwWsS]/, 'regex escape'], [/\(\?[:<=!]/, 'regex group'], [/\[[^\]]*[a-z0-9]-[a-z0-9][^\]]*\]|\[[^\]\s]*\\/, 'character class'],
  [/\b[a-z]+_[a-z_]+\b/, 'snake_case name'], [/\b\w+\.py\b/, 'file name']];
const problems = line => CODE.filter(([pattern]) => pattern.test(line)).map(([, what]) => what);

// Every print() in the engine whose text can reach a log: its literal with each {placeholder} filled by a count of 2.
const printed = files(SRC).flatMap(file => readFileSync(file, 'utf8').split('\n').flatMap(text => {
  const found = /\bprint\(\s*(f?)(["'])((?:\\.|(?!\2).)+)\2/.exec(text);
  return found ? [{file: file.slice(SRC.length - 3), line: found[3].replace(/\{[^{}]*\}/g, '2').replace(/\\n/g, ' ').replace(/\\(['"])/g, '$1').trim()}] : [];
}));

test('a line the engine prints is plain words once the log shows it', () => {
  assert.ok(printed.length > 300, `found ${printed.length} prints: the scan lost its way`);
  const bad = printed.flatMap(({file, line}) => readableLog([line]).flatMap(shown => problems(shown).map(what => `${file}: ${what}: ${shown}`)));
  assert.deepEqual(bad, []);
});

test('the lines of the owner\'s screenshot, as older runs kept them', () => {
  const shown = readableLog([
    'Places: worked out 1 place word(s) with AI: zug',
    'Job boards: jobs.ch, SwissDevJobs, TechTree (Swiss place word: \\bz[uü]rich\\b)',
    'Job boards: jobs.ch, SwissDevJobs, TechTree (Swiss place word: (?:(?<!\\w)zurich(?!\\w)))',
    'Job boards: jobs.ch (Swiss place word: \\bbern\\b); developer boards left out: your roles are outside IT',
    'Places: worked out 3 place word(s) with AI: zug, bern, basel',
  ]);
  assert.deepEqual(shown, [
    'Places: worked out 1 place word with AI: zug',
    'Job boards: jobs.ch, SwissDevJobs, TechTree',
    'Job boards: jobs.ch, SwissDevJobs, TechTree',
    'Job boards: jobs.ch; developer boards left out: your roles are outside IT',
    'Places: worked out 3 place words with AI: zug, bern, basel',
  ]);
});

test('"(s)" follows the number before it, one or more, and still reads without a number', () => {
  assert.deepEqual(readableLog(['2 batch(es) of 1 call(s); 0 job(s) left, 1 posting(s) read', 'Some function(s) wait']),
    ['2 batches of 1 call; 0 jobs left, 1 posting read', 'Some functions wait']);
});
