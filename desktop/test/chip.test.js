// Chips (design system, owner 17 Oct 2026: "Use chips"; 14 chip styles had grown, Strategy showed "Tax" in quotes): one component, components.js chip(),
// shows a value as a person writes it. Guards: what counts as raw syntax (renderer/chip-text.js), and no new chip class in any stylesheet (the list
// may only shrink as screens move to chip()). Rules: docs/rules/desktop-ui.md "Chips vs pills vs tags".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {isRawValue} from '../renderer/chip-text.js';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
// Today's chip classes (17 Oct 2026). Remove one when its last screen moves to chip(); never add one.
const KNOWN = new Set(['allowance-chip', 'allowance-chip-bar', 'allowance-chip-plan', 'allowance-chip-text', 'cal-chip', 'cal-chip-name', 'cal-chip-time', 'cal-chip-wrap', 'chip', 'chip-button', 'chip-count', 'chip-detail', 'chip-list', 'chip-more', 'chip-row', 'chip-tag', 'chips', 'chips-block', 'coverage-chip', 'coverage-chips', 'filter-chip', 'filter-chip-x', 'g-chip', 'iv-chip', 'iv-chips', 'jd-chips', 'pref-chips', 'ss-chips', 'ss-tip-chip', 'time-chip', 'why-chip', 'why-chips']);

test('a chip value in quotes, a /pattern/, regex marks or a stored comma list is raw syntax', () => {
  for (const raw of ['"Tax"', '“Sales”', '/z[uü]rich/i', 'site\\breliability', 'Zurich,Zurich,Switzerland', 'z[uü]rich']) assert.ok(isRawValue(raw), raw);
  for (const value of ['Tax', 'Site Reliability', 'Zurich, Switzerland', 'C++', 'Node.js', "Women's health", 'English', 'B permit', '80–100 %']) assert.equal(isRawValue(value), false, value);
});

test('no stylesheet adds a new chip class: a value from a list is drawn by chip() (components.js)', () => {
  const found = new Set(fs.readdirSync(renderer).filter(file => file.endsWith('.css'))
    .flatMap(file => [...fs.readFileSync(path.join(renderer, file), 'utf8').matchAll(/\.([a-z0-9-]*chip[a-z0-9-]*)/g)].map(match => match[1])));
  const added = [...found].filter(name => !KNOWN.has(name));
  assert.deepEqual(added, [], 'a new chip style: use chip(text, {detail, tone, onRemove}) from components.js and its .chip-tag look instead');
});

test('chip() marks raw text and names the value on its ×', () => {
  const source = fs.readFileSync(path.join(renderer, 'components.js'), 'utf8');
  const body = source.slice(source.indexOf('export function chip('), source.indexOf('// Tile:'));
  assert.match(body, /if \(isRawValue\(value\)\) node\.dataset\.raw = '1';/);
  assert.match(body, /aria-label', `Remove \$\{value\}`/);
});
