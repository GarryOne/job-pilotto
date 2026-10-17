// Each setup goal is edited in place with its typed control (owner, 17 Oct 2026): level chips, work mode picks, minimum salary with the salary kind; nothing unreadable is lost.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {GOAL_TILES, goalTiles} = await import('../renderer/goal-tiles.js');
const {GOAL_KINDS} = await import('../renderer/goal-kinds.js');
const {GOALS} = await import('../lib/goals.js');
const all = node => [node, ...(node.children || []).flatMap(all)];
const boxes = (goals, saved) => Object.fromEntries(goalTiles(goals, (...args) => saved.push(args), {fixed: {languages: () => {}}}).filter(node => node.dataset?.goal).map(node => [node.dataset.goal, node]));
const open = box => box.querySelector('.goal-edit').click();
const button = (box, name) => all(box).find(node => node.tagName === 'BUTTON' && node.textContent === name);

test('every goal has a kind (or is read-only), in the tiles and in the Profile rows', () => {
  assert.deepEqual(Object.keys(GOAL_KINDS).sort(), GOALS.slice().sort());
  assert.deepEqual(GOAL_TILES.map(tile => tile[0]).sort(), Object.keys(GOAL_KINDS).sort());
});

test('level: chips in place of the text, several picks (owner, 18 Oct 2026); a pick and Save writes them; an unchanged Save writes nothing', () => {
  const saved = [], box = boxes({seniority: 'Senior'}, saved).seniority;
  open(box);
  assert.ok(box.querySelector('.goal-editor'), 'the editor stands in for the value');
  assert.equal(all(box).some(node => node.contentEditable === 'plaintext-only'), false, 'no free text');
  assert.equal(button(box, 'Senior').getAttribute('aria-pressed'), 'true');
  button(box, 'Save').click();
  assert.deepEqual(saved, [], 'nothing changed');
  open(box);
  button(box, 'Staff / Principal').click();
  button(box, 'Save').click();
  assert.deepEqual(saved.map(args => args.slice(0, 2)), [['seniority', 'Senior, Staff / Principal']]);
});

test('work mode: several picks joined; text it cannot read stays visible as written', () => {
  const saved = [], box = boxes({work_mode: 'On-site, hybrid or remote'}, saved).work_mode;
  open(box);
  assert.match(box.textContent, /Saved as: On-site, hybrid or remote/);
  button(box, 'Hybrid').click();
  button(box, 'Remote').click();
  button(box, 'Save').click();
  assert.deepEqual(saved.map(args => args.slice(0, 2)), [['work_mode', 'On-site, Hybrid, Remote']]);   // the readable part (On-site) is kept, the rest picked
});

test('minimum salary: amount, currency, period; "(estimate)" text stays as written until changed; Cancel changes nothing', () => {
  const saved = [], box = boxes({minimum_salary: 'CHF 130,000 a year (estimate)'}, saved).minimum_salary;
  open(box);
  assert.match(box.textContent, /Saved as: CHF 130,000 a year/);
  const number = all(box).find(node => node.tagName === 'INPUT');
  number.value = '130000';
  number.dispatch('input');
  button(box, 'Cancel').click();
  assert.deepEqual(saved, []);
  open(box);
  const again = all(box).find(node => node.tagName === 'INPUT');
  again.value = '130000';
  again.dispatch('input');
  button(box, 'Save').click();
  assert.match(saved[0][1], /^130000 [A-Z]{3}\/year gross$/);
});

test('languages stay read-only here: "Edit in Your details", no editor', () => {
  const box = boxes({languages: 'English (C1)'}, []).languages;
  assert.equal(box.querySelector('.goal-edit'), null);
});
