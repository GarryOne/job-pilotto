// Rung 0 of the fill ladder, one truth per control (extension/page/read-back.js; spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 4): one reader gives every control kind
// its state, the panel, the fill's end read and the judges' sketch ask it, a page that only reformats what was typed stays committed, an upload slot is read by the file it shows
// (never by the extension's mark alone), and the fill's end pass writes each state on its control. The incidents the old copies grew from are cases here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';
import {readBackCounts, settleTrace} from '../../extension/trace-settle.js';

const JSDOM = await loadJsdom();
const FORM = `<form>
  <label for="name">Name</label><input id="name" value="">
  <label for="phone">Phone</label><input id="phone" value="+972">
  <label for="city">City</label><input id="city" value="Zurich">
  <label for="pays">Pays</label><select id="pays"><option value="">-- choose --</option><option value="CH">Suisse</option></select>
  <label for="anrede">Titre</label><select id="anrede"><option value="1">Monsieur</option><option value="2">Madame</option></select>
  <label for="ok">I agree</label><input id="ok" type="checkbox">
  <div class="select__container"><div class="select__control"><div class="select__single-value">Switzerland</div><input id="country" role="combobox"></div></div>
  <div class="pick"><input id="title-search" role="combobox" value="Mon"><input type="hidden" id="title-value" value="MR"><label for="title-value">Title</label></div>
  <div class="other"><input id="empty-combo" role="combobox"></div>
</form>`;

test('one state per control kind: a box, a calling code alone, a menu, a choice, a picklist chip or labelled hidden input', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, FORM);
  const state = id => window.__jobPilottoReadBack.stateOf(window.document.getElementById(id));
  assert.deepEqual(['name', 'phone', 'city'].map(state), ['empty', 'empty', 'committed'], 'a box holding only a calling code is empty (Recruitee "+972", 12 Oct 2026)');
  assert.deepEqual(['pays', 'anrede'].map(state), ['empty', 'committed'], 'a placeholder is no answer; a menu with no blank first option starts on a real one (easytemp, 9 Oct 2026)');
  assert.equal(state('ok'), 'empty');
  window.document.getElementById('ok').checked = true;
  assert.equal(state('ok'), 'committed');
  assert.equal(state('country'), 'committed', 'react-select: the chip holds the choice, the input is only search text (chosen Country, 11 Oct 2026)');
  assert.equal(state('title-search'), 'committed', 'a labelled hidden input holds the picklist choice (SuccessFactors, 8 Oct 2026)');
  assert.equal(state('empty-combo'), 'empty');
  assert.equal(window.__jobPilottoChosen, window.__jobPilottoReadBack.chosen, 'the name the audit and coverage.js call is the same rule');
  window.close();
});

test('a page that reformats what was typed stays committed; one that put something else there is a mismatch', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, '<input id="b">');
  const box = window.document.getElementById('b'), state = () => window.__jobPilottoReadBack.stateOf(box);
  const cases = [['41791234567', '079 123 45 67', 'committed'], ['41791234567', '+41 (79) 123-45-67', 'committed'], ['20261102', '02.11.2026', 'committed'],
    ['adalovelace', 'ADA LOVELACE', 'committed'], ['zurich', ' Zurich ', 'committed'], ['adalovelace', 'Bob', 'mismatch'], ['41791234567', '', 'empty']];
  for (const [typed, now, want] of cases) {
    box.setAttribute('data-jobpilotto-typed', typed); box.value = now;
    assert.equal(state(), want, `typed ${typed}, the page shows "${now}"`);
  }
  window.close();
});

const SLOT = (extra = '') => `<form><div class="field"><label for="first">First</label><input id="first" value="Ada"></div>
  <div class="field" id="slot"><label for="cv">Resume</label><div class="zone" id="zone"><input id="cv" type="file"><span>Upload file</span>${extra}</div></div></form>`;

test('an upload slot is read by the file it shows: a name in its area is in, the extension\'s own mark alone is unknown, nothing is empty', {skip: !JSDOM}, () => {
  const read = (html, mark) => {
    const window = openPage(JSDOM, html), input = window.document.getElementById('cv');
    if (mark) { input.dataset.jobPilottoFile = 'cv.pdf'; window.document.getElementById('slot').dataset.jobpilottoFile = 'cv.pdf'; }
    const state = window.__jobPilottoReadBack.fileState(input);
    window.close();
    return state;
  };
  assert.equal(read(SLOT(), false), 'empty');
  assert.equal(read(SLOT(), true), 'unknown', 'attached by us, the input emptied, nothing shown: never counted as filled (the refused upload)');
  assert.equal(read(SLOT('<div class="file-chip"><span>cv.pdf</span><button type="button">Remove</button></div>'), true), 'committed', 'a custom uploader that empties its input and shows a chip (case d)');
  assert.equal(read(SLOT('<div class="file-chip">resume_final.docx</div>'), false), 'committed', 'any file name the slot shows');
  window_files: {
    const window = openPage(JSDOM, SLOT()), input = window.document.getElementById('cv');
    Object.defineProperty(input, 'files', {value: [{name: 'cv.pdf'}]});
    assert.equal(window.__jobPilottoReadBack.fileState(input), 'committed', 'the input holds the file');
    window.close();
  }
});

test('the fill\'s end pass writes each control\'s state on it and returns them, with the CV\'s file name', {skip: !JSDOM}, async () => {
  const window = openPage(JSDOM, SLOT('<div class="file-chip">cv.pdf</div>'));
  const input = window.document.getElementById('cv');
  input.dataset.jobPilottoFile = 'cv.pdf';
  const rows = JSON.parse(JSON.stringify(await window.__jobPilottoReadBack.pass({quietMs: 50, maxMs: 500})));   // out of jsdom's realm
  assert.deepEqual(rows.map(row => [row.field, row.type, row.state]), [['first', 'text', 'committed'], ['cv', 'file', 'committed']]);
  assert.equal(rows[1].file, 'cv.pdf');
  assert.equal(window.document.getElementById('first').getAttribute('data-jobpilotto-r0'), 'committed');
  assert.equal(input.getAttribute('data-jobpilotto-r0'), 'committed');
  assert.deepEqual(readBackCounts(rows), {committed: 2});
  window.close();
});

test('the fill\'s record says what the slot shows, and why a box is left', () => {
  const trace = [{label: 'CV', type: 'file', source: 'your CV', outcome: 'left', reason: 'no place to attach it was found on this page'}, {label: 'Phone', type: 'tel', outcome: 'filled', reason: ''}];
  const final = [{label: 'Phone', field: 'phone', filled: false}];
  const shown = settleTrace(trace, final, [], [{field: 'cv', type: 'file', state: 'committed', file: 'cv.pdf'}, {field: 'phone', type: 'tel', state: 'mismatch'}], 'cv.pdf');
  assert.deepEqual(shown.map(row => [row.label, row.outcome]), [['CV', 'filled'], ['Phone', 'left']], 'the page cleared the input but shows the file: the CV is in (case d)');
  assert.match(shown[1].reason, /changed what was typed/);
  const unread = settleTrace([{...trace[0], outcome: 'filled', reason: ''}], [], [], [{field: 'cv', type: 'file', state: 'unknown', file: 'cv.pdf'}], 'cv.pdf');
  assert.deepEqual([unread[0].outcome, unread[0].reason], ['left', 'the file was attached, but the slot shows no file: check it'], 'unknown is never counted as filled');
  const letterOnly = settleTrace([trace[0]], [], [], [{field: 'letter', type: 'file', state: 'committed', file: 'letter.pdf'}], 'cv.pdf');
  assert.equal(letterOnly[0].outcome, 'left', 'a cover letter that shows is not the CV');
  assert.deepEqual(settleTrace(trace, final, [], []).map(row => row.outcome), ['left', 'left'], 'with no read-back, the rows decide as before');
});
