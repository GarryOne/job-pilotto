// The generic operators (extension/page/controls.js): each sets one kind of control the way a person would and says whether it
// worked, matched to an answer by field id or by the question, never touching a question that is off limits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const module = {exports: {}};
new Function('module', 'window', fs.readFileSync(new URL('../../extension/page/controls.js', import.meta.url), 'utf8'))(module, {});
const ops = module.exports;
const noop = () => {};

const toggleBox = (labels = ['Yes', 'No'], pressed = []) => {
  const buttons = labels.map(text => {
    const state = {'aria-pressed': pressed.includes(text) ? 'true' : 'false'};
    const button = {textContent: text, getAttribute: name => state[name] ?? null, getClientRects: () => [1]};
    button.click = () => { for (const other of buttons) other.set('false'); state['aria-pressed'] = 'true'; };
    button.set = value => { state['aria-pressed'] = value; };
    return button;
  });
  return {buttons, querySelectorAll: () => buttons, querySelector: () => null};
};
const entry = (title, box, ids = []) => Object.assign(box, {
  parentElement: {querySelector: () => ({textContent: title}), parentElement: null},
  closest: () => null,
  idsList: ids,
});

test('answers are read as yes or no however they are written', () => {
  assert.deepEqual(['Yes', 'yes, I am', 'Ja', 'oui', 'TRUE'].map(ops.yesNo), ['yes', 'yes', 'yes', 'yes', 'yes']);
  assert.deepEqual(['No', 'no.', 'Nein', 'false'].map(ops.yesNo), ['no', 'no', 'no', 'no']);
  assert.equal(ops.yesNo('Maybe later'), '');
});

test('dates are understood in the usual written forms and given to a field in the shape it asks for', () => {
  assert.deepEqual(ops.parseDate('2026-11-01'), {y: 2026, m: 11, d: 1});
  assert.deepEqual(ops.parseDate('01.11.2026'), {y: 2026, m: 11, d: 1});
  assert.deepEqual(ops.parseDate('1 Nov 2026'), {y: 2026, m: 11, d: 1});
  assert.deepEqual(ops.parseDate('11/25/2026'), {y: 2026, m: 11, d: 25});   // a month above 12 settles a slash date
  assert.equal(ops.parseDate('as soon as possible'), null);
  assert.equal(ops.parseDate('31.13.2026'), null);
  const date = {y: 2026, m: 11, d: 1};
  assert.equal(ops.formatDate(date, {type: 'date'}), '2026-11-01');
  assert.equal(ops.formatDate(date, {type: 'text', placeholder: 'dd.mm.yyyy'}), '01.11.2026');
  assert.equal(ops.formatDate(date, {type: 'text', placeholder: 'yyyy-mm-dd'}), '2026-11-01');
  assert.equal(ops.formatDate(date, {type: 'text', placeholder: 'Pick date...'}), '11/01/2026');
});

test('an answer is matched to a control by its field id first, else by the question text', () => {
  const answers = [{field: 'q1', question: 'Anything else?', value: 'No'}, {field: 'q2', question: 'Are you authorized to work in the country where the job is located?', value: 'Yes'}];
  assert.equal(ops.matchAnswer(answers, {ids: new Set(['q1']), question: 'whatever'}).field, 'q1');
  assert.equal(ops.matchAnswer(answers, {ids: new Set(), question: 'Are you authorized to work in the country where the job is located?'}).field, 'q2');
  assert.equal(ops.matchAnswer(answers, {ids: new Set(), question: 'Are you authorized to work'}).field, 'q2');   // the form's title inside the kit's longer question
  assert.equal(ops.matchAnswer(answers, {ids: new Set(), question: 'Anything'}), undefined);   // too short to be sure
});

test('a toggle group presses the option named by the answer and checks it stayed', async () => {
  const box = toggleBox();
  assert.deepEqual(await ops.setToggleGroup(box, 'Yes'), {ok: true});
  assert.deepEqual(box.buttons.map(b => b.getAttribute('aria-pressed')), ['true', 'false']);
  assert.deepEqual(await ops.setToggleGroup(box, 'No, I do not'), {ok: true});
  assert.deepEqual(box.buttons.map(b => b.getAttribute('aria-pressed')), ['false', 'true']);
  assert.equal((await ops.setToggleGroup(box, 'Perhaps')).ok, false);
  const stuck = toggleBox(); stuck.buttons[0].click = noop;   // a page that ignores the click
  assert.equal((await ops.setToggleGroup(stuck, 'Yes')).ok, false);
});

test('a date field gets the date in its format and must keep it', async () => {
  const input = {type: 'text', placeholder: 'dd.mm.yyyy', value: '', focus: noop, dispatchEvent: noop};
  assert.deepEqual(await ops.setDate(input, '2026-11-01'), {ok: true, text: '01.11.2026'});
  assert.equal(input.value, '01.11.2026');
  assert.equal((await ops.setDate({...input, value: ''}, 'soon')).ok, false);
  const forgetful = {type: 'text', placeholder: '', focus: noop, dispatchEvent: noop, get value() { return ''; }, set value(_) {}};
  assert.equal((await ops.setDate(forgetful, '2026-11-01')).ok, false);
});

test('a custom dropdown opens, picks the option by its text, and must show it', async () => {
  const trigger = {textContent: 'Select…', click() { opened = true; }};
  let opened = false;
  const option = text => ({textContent: text, children: [], getClientRects: () => [1], click() { trigger.textContent = text; }});
  const doc = {querySelectorAll: () => (opened ? [option('Switzerland'), option('Sweden')] : [])};
  assert.equal((await ops.setCustomSelect(trigger, 'Sweden', doc)).ok, true);
  assert.equal(trigger.textContent, 'Sweden');
  opened = false;
  assert.equal((await ops.setCustomSelect(trigger, 'Norway', doc)).ok, false);
});

test('fill offers only matched, permitted controls to the operators and reports each', async () => {
  const yes = entry('Are you authorized to work in the country where the job is located?', toggleBox());
  const consent = entry('I agree to the privacy policy', toggleBox());
  const stranger = entry('Do you like cats today?', toggleBox());
  const kit = {widgets: () => [yes, consent, stranger].map(el => ({el, kind: 'toggle-group'}))};
  const doc = {querySelectorAll: () => []};
  const answers = [{question: 'Are you authorized to work in the country where the job is located?', value: 'Yes'},
    {question: 'I agree to the privacy policy', value: 'Yes'}];
  const results = await ops.fill(answers, {doc, kit, skip: question => /agree|privacy/i.test(question)});
  assert.deepEqual(results.map(r => [r.question.slice(0, 12), r.ok]), [['Are you auth', true]]);
  assert.equal(consent.buttons.some(b => b.getAttribute('aria-pressed') === 'true'), false);   // consent never touched
  assert.equal(stranger.buttons.some(b => b.getAttribute('aria-pressed') === 'true'), false);  // no answer, no action
});
