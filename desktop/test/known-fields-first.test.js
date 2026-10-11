// Known fields first (apply-latency E, owner 11 Oct 2026): without a kit, the fields your details and CV answer are filled at once and Claude's answers
// fill a second pass when they come (as after a kit); a "not eligible" answer then keeps what is filled and the note says so. Source checks on
// extension/flow.js (the service worker cannot be loaded here); the recorded replays and the journey gate run the fill itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');

test('without a kit, Claude is asked and the known fields are filled before its answer is awaited', () => {
  const asked = flow.indexOf('pendingAI = askedEarly ?'), firstPass = flow.indexOf('window.__jobPilottoExtensionFill(list, profile, resume, letter, consents)'), awaited = flow.indexOf('ai = pendingAI ? await pendingAI');
  assert.ok(asked > 0 && firstPass > asked && awaited > firstPass, 'ask, then fill the known fields, then await the answers');
  assert.match(flow, /later = open;\n    \}\n  \}/, 'the answers fill as a second pass');
  assert.doesNotMatch(flow, /import\('\.\/log\.js'\)/, 'no dynamic import: a service worker refuses import()');
  assert.match(flow, /if \(pendingAI\) decide\('fill', 'first fields filled'/, 'the first fields are logged (the time to first field is measured from it)');
});

test('not eligible after the first pass: what is filled stays, and the note says only your details were filled', () => {
  assert.match(flow, /return \{ineligible: true, partly: true, note: ai\.eligibility_note \|\| '', usd: ai\.usd\}/);
  assert.match(background, /await ineligibleNote\(tab\.id, result\.note, result\.partly\)/);
});

test('the second pass carries Claude\'s cover letter when there is no kit (the first pass had none yet)', () => {
  assert.match(flow, /\[extra, withKit \? '' : coverLetter \|\| ai\?\.cover_letter \|\| '', config\.acceptConsents === true\]/);
});
