import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('extension page helpers are the same as the tools/ originals (run extension/sync.sh)', () => {
  for (const name of ['browser-submit-guard.js', 'browser-form-fastpath.js']) {
    assert.equal(read(`extension/page/${name}`), read(`tools/${name}`), name);
  }
});

test('manifest asks for activeTab, debugger, scripting and storage, and runs by itself only on the job-application sites', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  // debugger: real clicks on dropdowns, used only when Settings → Fill drop-down menus too is on (Chrome can't make it optional).
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'debugger', 'scripting', 'storage']);
  // Granted at install, so tabs opened by the app or "Open & fill" fill themselves (as optional
  // permissions they needed a prompt that closed the popup, and nothing filled).
  assert.deepEqual(manifest.host_permissions, ['https://*.greenhouse.io/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*',
    'https://*.myworkdayjobs.com/*', 'https://*.smartrecruiters.com/*', 'https://apply.workable.com/*']);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
});

test('contact details go into matching empty text fields, never over kit answers or filled fields', () => {
  const window = {};
  vm.runInNewContext(read('extension/page/fill.js'), {window, document: {}});
  const rows = [
    {field: 'first_name', label: 'First Name*', type: 'text', filled: false},
    {field: 'last_name', label: 'Last Name', type: 'text', filled: false},
    {field: 'email', label: 'Email', type: 'email', filled: true},
    {field: 'phone', label: 'Phone', type: 'tel', filled: false},
    {field: 'question_9', label: 'LinkedIn Profile', type: 'text', filled: false},
    {field: 'question_10', label: 'Website', type: 'text', filled: false},
    {field: 'country', label: 'Location (City)', type: 'combobox', filled: false},
    {field: 'name', label: 'Name', type: 'text', filled: false},
    {field: 'consent', label: 'I agree to the privacy policy', type: 'text', filled: false, legal: true},
  ];
  const profile = {first_name: 'Ada', last_name: 'L', full_name: 'Ada L', email: 'a@b.c', phone: '+41',
                   linkedin: 'https://linkedin.com/in/ada', website: 'https://ada.dev', location: 'Zurich'};
  const entries = JSON.parse(JSON.stringify(window.__jobPilottoProfileEntries(rows, profile, ['question_10'])));
  assert.deepEqual(entries, [
    {field: 'first_name', value: 'Ada'}, {field: 'last_name', value: 'L'},
    {field: 'phone', value: '+41'}, {field: 'question_9', value: 'https://linkedin.com/in/ada'},
  ]);
});
