// A price we only guess is never shown as a number: "a few cents", the wording the app already uses (owner, 9 Oct 2026: a fixed "~12¢" read as
// $12 and is not known anyway). Computed estimates (≈ $0.45 for N postings, from a count) are real arithmetic and stay.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const walk = dir => readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

test('no fixed ¢ price in the window or the app: buttons, hints and tooltips say "a few cents"', () => {
  const found = ['renderer', 'lib'].flatMap(walk).filter(file => /\.(js|html)$/.test(file))
    .flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line]).filter(([, , line]) => /\d¢/.test(line)).map(([f, n]) => `${f}:${n}`));
  assert.deepEqual(found, []);
});
