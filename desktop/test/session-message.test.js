import assert from 'node:assert/strict';
import {test} from 'node:test';
import {latestStep, readSessionMessage} from '../renderer/session-message.js';

// The shape of a real final report (fictional details).
const REPORT = `The Example Labs application (Engineering Manager, London) is filled in the open Chrome tab and ready for you to review and click Submit. Nothing was submitted.

- **Extension:** it returned an error, so I filled the whole form myself.
- **Filled:** all the required fields plus the optional ones.
- **Yes/No questions:**
  - On-prem Kubernetes experience: No
  - Will need sponsorship: Yes
- **Nothing left empty.** This form has no education section.
- **Check before you submit:**
  - The infrastructure answer says you don't have on-prem Kubernetes experience.
  - It's a UK role, so you'll need visa sponsorship.
- **Run record:** saved to Notion. The form checker didn't detect the CV, so I marked it attached by hand.`;

test('a report: only the "Check before you submit" items are checks; the audit and the rest are apart', () => {
  const {checks, audit, done, intro} = readSessionMessage(REPORT);
  assert.deepEqual(checks, [
    "The infrastructure answer says you don't have on-prem Kubernetes experience.",
    "It's a UK role, so you'll need visa sponsorship.",
  ]);
  assert.match(audit, /^saved to Notion\. .*by hand\.$/);
  assert.deepEqual(done.map(section => section.label), ['Extension', 'Filled', 'Yes/No questions', 'Nothing left empty']);
  assert.deepEqual(done[2].items, ['On-prem Kubernetes experience: No', 'Will need sponsorship: Yes']);
  assert.equal(intro.length, 1);
});

test('a short question: its bullets are what to check, the audit paragraph is found', () => {
  const {checks, audit, done, intro} = readSessionMessage(
    'Please check these answers:\n\n- **Visa:** "Yes"\n- The salary field\n\n**Audit file:** fixed one row.\n\nShall I leave them?');
  assert.deepEqual(checks, ['**Visa:** "Yes"', 'The salary field']);
  assert.equal(audit, 'fixed one row.');
  assert.deepEqual(done, []);
  assert.deepEqual(intro, ['Please check these answers:', 'Shall I leave them?']);
});

test('the latest step: the last ● line of the terminal output, without colours or cursor moves', () => {
  const output = '\x1b[1m●\x1b[0m Kit found; opening the form now.\r\n  Called claude-in-chrome\r\n' +
    '\x1b[38;5;15m●\x1b[39m\x1b[1CForm\x1b[1Copen with the extension hook present.\r\n\x1b[2K> ';
  assert.equal(latestStep(output), 'Form open with the extension hook present.');
  assert.equal(latestStep('no steps yet'), '');
});
