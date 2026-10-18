// The Documents tab (job-drawer/tab-documents.js): the tailored CV and the cover letter moved out of Application → Preparation, each fact one
// label → value row, and every way in lands on it. One loop over the entry points; a new tab alias or entry without a test fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {TABS, tabKey} from '../renderer/job-page-view.js';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('Documents is the tab right after Application, and the Application tab no longer draws the letter or the files', () => {
  const keys = TABS.map(([key]) => key);
  assert.equal(keys[keys.indexOf('application') + 1], 'documents');
  const prep = read('job-drawer/application-preparation.js');
  assert.doesNotMatch(prep, /jobLetterView|documentsView|Cover letter/);
  assert.match(read('job-drawer/tab-documents.js'), /jobLetterView/);
});

test('every way in lands on Documents (tab keys, aliases) and the kit\'s old names still land on Application', () => {
  for (const name of ['documents', 'cv', 'letter', 'cover-letter', 'files']) assert.equal(tabKey(name), 'documents', name);
  for (const name of ['kit', 'prep', 'record']) assert.equal(tabKey(name), 'application', name);
  const nav = read('pages/nav.js');
  assert.match(nav, /Open documents: \$\{job\.title\}[\s\S]{0,260}openJobPanel\(job, 'documents'\)/, '⌘K opens the tab');
  assert.match(read('job-drawer/tabs-body.js'), /documents: documentsTab/);
});

test('the Documents cards are label → value rows with at most one primary button each, no lone caption lines', () => {
  for (const file of ['job-drawer/tab-documents.js', 'job-drawer/job-letter.js']) {
    const source = read(file);
    assert.match(source, /rows\(/, file);
    assert.doesNotMatch(source, /el\('p', 'muted small'/, `${file}: a status goes in a row, not a caption line`);
  }
  assert.match(read('job-drawer/job-letter.js'), /docCopy\(status\.text, 'Copy', true\)/, 'the letter card has one primary: Copy');
  assert.doesNotMatch(read('job-drawer/tab-documents.js') + read('job-drawer/job-letter.js'), /soft-button|'link'/, 'every other button is the standard secondary');
});

test('the Documents tab says "not drafted yet" through the state card, with the action that drafts it', () => {
  const source = read('job-drawer/tab-documents.js');
  assert.match(source, /stateCard\(\{icon: 'file', title: 'Not drafted yet'/);
  assert.match(source, /tailorCv\(job\.code/);
});
