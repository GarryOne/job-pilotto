// Strategy's goal tiles (renderer/goal-tiles.js): Work eligibility and Languages are Your details' facts (owner, 17 Oct 2026: one home per value),
// so Strategy shows them read-only with "Edit in Your details" and no pencil; the search goals stay editable in place. Tiny DOM (test/tiny-dom.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {GOAL_TILES, goalTiles} = await import('../renderer/goal-tiles.js');

test('a fixed tile shows its value and "Edit in Your details", never a pencil; the others keep theirs', () => {
  const opened = [];
  const tiles = [...GOAL_TILES, ['eligibility', 'shield', 'Work eligibility']];
  const nodes = goalTiles({seniority: 'Senior', languages: 'English, German (B1)', eligibility: 'Swiss B permit'}, () => {},
    {tiles, fixed: {languages: () => opened.push('languages'), eligibility: () => opened.push('eligibility')}});
  const boxes = Object.fromEntries(nodes.filter(node => node.dataset?.goal).map(node => [node.dataset.goal, node]));
  assert.deepEqual(Object.keys(boxes), ['seniority', 'work_mode', 'minimum_salary', 'languages', 'eligibility']);
  for (const key of ['languages', 'eligibility']) {
    assert.equal(boxes[key].querySelector('.goal-edit'), null, `${key}: no pencil`);
    const link = boxes[key].querySelector('.goal-elsewhere button');
    assert.equal(link.textContent, 'Edit in Your details');
    link.click();
  }
  assert.deepEqual(opened, ['languages', 'eligibility']);
  for (const key of ['seniority', 'work_mode', 'minimum_salary']) assert.ok(boxes[key].querySelector('.goal-edit'), `${key}: still edited here`);
});

test('the Strategy page passes Work eligibility and Languages as fixed, each to its own Your details section', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/strategy-targets.js', import.meta.url), 'utf8');
  assert.match(source, /fixed: \{eligibility: \(\) => openSetting\('eligibility'\), languages: \(\) => openSetting\('languages'\)\}/);
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  for (const key of ['eligibility', 'languages']) assert.match(html, new RegExp(`id="setting-${key}"[^>]*data-profile-panel="details"|data-profile-panel="details"[^>]*id="setting-${key}"`), key);
});
