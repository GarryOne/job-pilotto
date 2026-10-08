// No price is shown before an action (owner, 9 Oct 2026): not a fixed "~12¢" (read as $12), not "about $0.25", not "≈ $0.45". The cost is not known (it
// depends on the CV, the model, and the engine: a person on their own Claude Code pays a subscription, not credits). What a run actually spent, shown after it
// ran (run cards, "Actual cost"), is a fact and stays; so do the AI-cost pages.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));   // not .pathname: on Windows that is /D:/… (CI red, 9 Oct 2026)
const walk = dir => readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const PRICE = /\d¢|a few cents|(?:about|≈|~) ?\$\d|\(\$?\d+(?:\.\d+)? ?(?:cents|¢)\)/i;

test('no price in a button, hint, tooltip or dialog before the action: the words say what it does, not what it costs', () => {
  const found = ['renderer', 'lib'].flatMap(walk).filter(file => /\.(js|html)$/.test(file))
    .flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line.trim()])
      .filter(([, , line]) => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('<!--') && PRICE.test(line)).map(([f, n]) => `${f}:${n}`));
  assert.deepEqual(found, []);
});
