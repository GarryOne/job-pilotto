// Guard: a page that can be hidden (Interviews, Reports, Employers; Calendar is a tab of Interviews) is never opened by a direct .nav click; steps go through lib/go-view.mjs (CI, 17 Oct 2026: two Windows interactions steps timed out on a hidden button).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const HIDEABLE = /(interviews|reports|employers|calendar)/;
const files = ['lib', 'suites'].flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith('.mjs')).map(name => path.join(dir, name))).filter(file => file !== path.join('lib', 'go-view.mjs'));

// Lines that press a nav button for a page chosen at run time (an interpolated name) or for a hideable page by name.
export const directNavClicks = text => text.split('\n').map((line, at) => ({line, at: at + 1})).filter(({line}) => /\.click\(/.test(line) && /\.nav\[data-view=/.test(line) && (/\.nav\[data-view=["']?\$\{/.test(line) || new RegExp(`\\.nav\\[data-view=["']?${HIDEABLE.source}`).test(line)));

test('no step presses a nav button for a page chosen at run time or for a page that can be hidden', () => {
  const found = files.flatMap(file => directNavClicks(fs.readFileSync(path.join(root, file), 'utf8')).map(({line, at}) => `${file}:${at}: ${line.trim().slice(0, 100)}`));
  assert.deepEqual(found, [], `use goView(page, view) from lib/go-view.mjs:\n${found.join('\n')}`);
});

test('the scan catches the shapes it is for', () => {
  assert.equal(directNavClicks('await page.click(`.nav[data-view="${view}"]`);').length, 1);
  assert.equal(directNavClicks("await page.click('.nav[data-view=\"reports\"]');").length, 1);
  assert.equal(directNavClicks("await page.click('.nav[data-view=\"jobs\"]');").length, 0);
});
