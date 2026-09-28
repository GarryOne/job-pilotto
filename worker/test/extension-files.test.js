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

test('manifest asks for activeTab, alarms, debugger, scripting and storage, and runs by itself only on the job-application sites', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  // debugger: real clicks on dropdowns, used only when Settings → Fill drop-down menus too is on (Chrome can't make it optional).
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'alarms', 'debugger', 'scripting', 'storage']);
  // The flow's own list ("Opened in Chrome", auto-fill) is the same.
  assert.match(read('extension/flow.js'), /successfactors\.eu/);
  // Granted at install, so tabs opened by the app or "Open & fill" fill themselves (as optional
  // permissions they needed a prompt that closed the popup, and nothing filled).
  assert.deepEqual(manifest.host_permissions, ['https://*.greenhouse.io/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*',
    'https://*.myworkdayjobs.com/*', 'https://*.smartrecruiters.com/*', 'https://apply.workable.com/*',
    'https://*.successfactors.eu/*', 'https://*.successfactors.com/*', 'https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*', 'https://*.teamtailor.com/*', 'https://*.recruitee.com/*', 'https://*.softgarden.io/*', 'https://*.umantis.com/*', 'https://*.taleo.net/*', 'https://*.icims.com/*', 'https://*.bamboohr.com/*']);
  // Every other site only through Settings → Work on every job site (asked from the options tab, which stays open).
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.match(read('extension/options.js'), /chrome\.permissions\.request\(EVERY_SITE\)/);
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

test('consent boxes are recognised by whole words (Acknowledge, consents, certify), not only stems', () => {
  const source = read('extension/page/fill.js');
  const LEGAL = eval(source.match(/const LEGAL = (\/.*\/i);/)[1]);
  for (const text of ['Acknowledge', 'I consent to Twilio collecting', 'By checking this box, I confirm I have read the policy',
    'I certify that the information is true', 'Privacy Policy']) assert.ok(LEGAL.test(text), text);
  for (const text of ['How did you hear about us?', 'Current company', 'Terminal skills', 'Are you legally authorized to work in the country?']) assert.ok(!LEGAL.test(text), text);
});

test('Apply with Claude hand-off: hook only on the job sites (every site once allowed), ticket checked by the app before filling', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.deepEqual(manifest.content_scripts, [{matches: manifest.host_permissions, js: ['hook.js'], run_at: 'document_idle'}]);
  const hook = read('extension/hook.js');
  assert.match(hook, /addEventListener\('jobpilotto:fill'/);
  assert.match(hook, /typeof request\?\.ticket !== 'string'/);
  const background = read('extension/background.js');
  const handOff = background.slice(background.indexOf('async function handOff'));
  assert.ok(handOff.indexOf("'/extension/ticket'") > 0 && handOff.indexOf("'/extension/ticket'") < handOff.indexOf('fillOpenedTab('),
    'the ticket is checked before any fill');
  assert.match(background, /registerContentScripts\(\[\{id: 'hook-everywhere'/);
  // The events a page can send carry no personal data, and the result written back holds only counts and field labels.
  assert.doesNotMatch(handOff.slice(0, handOff.indexOf('const EVERY_SITE')), /contact|resume|profile/);
});

test('the Submit guard can be loaded twice on a page (a second fill) without throwing', () => {
  const code = read('extension/page/browser-submit-guard.js');
  const noop = () => {};
  const window = { __jobPilottoNoGuard: true, addEventListener: noop };
  const context = vm.createContext({ window, document: { addEventListener: noop, querySelectorAll: () => [] },
    HTMLFormElement: function () {}, HTMLElement: function () {}, Element: function () {}, MutationObserver: function () { this.observe = noop; } });
  window.window = window;
  assert.doesNotThrow(() => { vm.runInContext(code, context); vm.runInContext(code, context); });
  assert.equal(window.__jobPilottoGuardActive, false);
});
