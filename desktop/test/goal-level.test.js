// Your level has one home, Goals → Target level (owner, 18 Oct 2026: "Goals only"); the search's level follows it. The owner's saved value is a floor written
// in words ("Senior or higher (Senior, Staff/Principal, Lead/Manager)"): the level chips show it picked, several at once (owner, 18 Oct 2026: "this one look broken":
// a one-of control showed nothing selected). A choice control never hides a saved value it can't show: "Saved as: …" stands under it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {levelPicks, searchLevel} = await import('../renderer/goal-kinds.js');
const {goalTiles} = await import('../renderer/goal-tiles.js');
const {answerControl} = await import('../renderer/question-control.js');
const {levelFollowsGoal} = await import('../lib/goal-level.js');
const all = node => [node, ...(node.children || []).flatMap(all)];
const OWNER = 'Senior or higher (Senior, Staff/Principal, Lead/Manager)';

test('the saved level is read by the level names it states, several at once', () => {
  assert.deepEqual(levelPicks(OWNER), ['Senior', 'Staff / Principal', 'Lead']);
  assert.deepEqual(levelPicks('Senior'), ['Senior']);
  assert.deepEqual(levelPicks('Staff / Principal'), ['Staff / Principal']);
  assert.deepEqual(levelPicks('Mid, Senior'), ['Mid', 'Senior']);
  assert.deepEqual(levelPicks(''), []);
  assert.deepEqual(levelPicks('Midfield operations'), [], 'a word inside another is not a level');
});

test('the search level keeps every picked level: titles of a level not picked are skipped only when no pick is hit', () => {
  const cases = [[OWNER, 'senior'], ['Senior', 'senior'], ['Staff / Principal, Lead', 'lead'], ['Mid, Senior', 'senior'], ['Mid', 'mid'], ['Junior', 'junior'],
    ['Junior, Mid', 'junior'], ['Junior, Senior', ''], ['', ''], ['something else', '']];
  for (const [goal, level] of cases) assert.equal(searchLevel(goal), level, goal);
});

test('Target level: the owner\'s floor opens with its three levels picked; a pick and Save writes the picks', () => {
  const saved = [];
  const box = goalTiles({seniority: OWNER}, (...args) => saved.push(args)).find(node => node.dataset?.goal === 'seniority');
  box.querySelector('.goal-edit').click();
  const pressed = all(box).filter(node => node.tagName === 'BUTTON' && node.getAttribute('aria-pressed') === 'true').map(node => node.textContent);
  assert.deepEqual(pressed, ['Senior', 'Staff / Principal', 'Lead']);
  assert.match(box.textContent, /Saved as: Senior or higher/, 'his words stay visible until he saves');
  all(box).find(node => node.textContent === 'Mid' && node.tagName === 'BUTTON').click();
  all(box).find(node => node.textContent === 'Save').click();
  assert.deepEqual(saved.map(args => args.slice(0, 2)), [['seniority', 'Mid, Senior, Staff / Principal, Lead']]);
});

test('every choice control shows a saved value it has no option for, never nothing', () => {
  const formats = [{kind: 'yes_no', control: 'yes_no', options: ['Yes', 'No']}, {kind: 'single', control: 'single', options: ['Remote', 'Hybrid']},
    {kind: 'multi', control: 'multi', options: ['On-site', 'Hybrid', 'Remote']}];
  for (const format of formats) {
    const node = answerControl(format, 'Only with a B permit', () => {});
    const shown = all(node).some(each => each.className?.includes('is-active')) || /Saved as: Only with a B permit/.test(node.textContent);
    assert.ok(shown, `${format.kind}: the saved value is shown`);
    assert.equal(node.value, 'Only with a B permit', `${format.kind}: and kept`);
  }
});

test('a Target level save sets the search level when it differs; the same level writes nothing', async () => {
  const edits = [];
  const editLists = async (_storage, asked) => { edits.push(asked); return {changed: Object.keys(asked)}; };
  assert.deepEqual(await levelFollowsGoal({}, OWNER, '', {editLists}), {changed: true, level: 'senior'});
  assert.deepEqual(edits, [{level: {set: 'senior'}}]);
  assert.deepEqual(await levelFollowsGoal({}, 'Senior', 'senior', {editLists}), {changed: false, level: 'senior'});
  assert.equal(edits.length, 1);
});

test('Strategy: Your level is read-only, from Target level, with "Change in Goals"; no second level control', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/strategy-targets.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /targetEdits\.level\s*=/, 'the search card never edits the level');
  assert.match(source, /Change in Goals/);
});
