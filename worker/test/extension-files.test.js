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
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'alarms', 'debugger', 'scripting', 'storage', 'webNavigation']);
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

test('Apply with Claude hand-off: hook only on a tab the app opened, ticket checked by the app before filling', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  // No content script. hook.js and review.js are injected into a tab the desktop app opened, nowhere else.
  assert.equal(manifest.content_scripts, undefined);
  const hook = read('extension/hook.js');
  assert.match(hook, /addEventListener\('jobpilotto:fill'/);
  assert.match(hook, /typeof request\?\.ticket !== 'string'/);
  const background = read('extension/background.js');
  const handOff = background.slice(background.indexOf('async function handOff'), background.indexOf('// Older builds registered'));
  assert.ok(handOff.indexOf("'/extension/ticket'") > 0 && handOff.indexOf("'/extension/ticket'") < handOff.indexOf('fillOpenedTab('),
    'the ticket is checked before any fill');
  assert.match(background, /unregisterContentScripts\(\{ids: \['hook-everywhere'\]\}\)/);
  assert.doesNotMatch(background, /\.registerContentScripts\(/);
  assert.match(background, /message\?\.type === 'panelAllowed'/);
  // The events a page can send carry no personal data, and the result written back holds only counts and field labels.
  assert.doesNotMatch(handOff, /contact|resume|profile/);
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

test('the panel (review.js) is read only: it never types, ticks, clicks or submits anything in the form', () => {
  const ring = read('extension/review.js');
  // Only its own ring and panel get click handlers; the form's fields are scrolled to, outlined and focused.
  assert.doesNotMatch(ring, /\.click\(\)|\.checked\s*=[^=]|\.value\s*=[^=]|dispatchEvent|\.submit\(|requestSubmit/);
  assert.match(ring, /attachShadow/);
  // It talks to the app only through the extension's background worker, never from the page's origin.
  assert.doesNotMatch(ring, /fetch\(|XMLHttpRequest/);
  assert.match(ring, /const send = message => \(chrome\.runtime\?\.id \? chrome\.runtime\.sendMessage\(message\)/);
  assert.match(ring, /send\(\{type: 'review', payload\}\)/);
});

test('an out-of-date extension in Chrome loads the new copy by itself, and only rejoins tabs the app opened', () => {
  const background = read('extension/background.js');
  const newer = new Function(`${background.match(/export function newer[\s\S]*?\n}\n/)[0].replace('export ', '')}; return newer;`)();
  assert.equal(newer('0.7.1', '0.6.8'), true);
  assert.equal(newer('0.7.1', '0.7.1'), false);
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.match(background, /reloadedFor !== answer\.latest/);  // once per version: no reload loop
  assert.match(background, /executeScript\(\{target: \{tabId, allFrames: true\}, files: \['page\/skeleton\.js', 'page\/coverage\.js', 'hook\.js', 'review\.js'\], injectImmediately: true\}\)/);
  assert.match(background, /jobpilotto-review-host/);
  assert.match(read('extension/review.js'), /send\(\{type: 'panelAllowed'\}\)/);
  // A copy left behind by a reload gives way to the fresh one instead of blocking it.
  assert.match(read('extension/review.js'), /__jobPilottoReviewAlive\?\.\(\)/);
  assert.match(read('extension/hook.js'), /__jobPilottoHookAlive\?\.\(\)/);
});

test('a kit fill starts at once: kit and contact details prefetched, no fixed wait from the panel, quick dropdowns', () => {
  const background = read('extension/background.js');
  assert.match(background, /const data = await prefetch\(config, /);  // the panel's first look fetches both
  assert.match(background, /fillOpenedTab\(sender\.tab, url, !!message\.force, \{fast: true\}\)/);
  assert.match(background, /if \(!fast\) await new Promise/);
  // Your CV is read again when the prefetch is a few seconds old: a CV tailored after the form was first seen must be the one attached.
  assert.match(background, /Date\.now\(\) - ready\.meAt > ME_FRESH_MS/);
  const flow = read('extension/flow.js');
  assert.match(flow, /const me = early \|\| await api\(/);
  assert.match(flow, /limit = 1500; waited < limit; waited \+= 100/);
});

test('a CV tailored after the first fill replaces the one the extension attached, never one the person chose', () => {
  const fill = read('extension/page/fill.js');
  assert.match(fill, /input\.dataset\.jobPilottoFile = file\.name/);
  assert.match(fill, /ours && input\.files\[0\]\.name === ours && ours !== file\.name/);
  const review = read('extension/review.js');
  assert.match(review, /panelTailor/);                                          // the panel offers a CV tailored to the job
  assert.match(review, /ready && !filling && !readyNow/);                       // and the Fill button stays to attach it
  assert.match(read('extension/background.js'), /type: 'tailor-cv'/);
});

test('the form panel marks the questions a hiring system can reject on, first', () => {
  const review = read('extension/review.js');
  assert.match(review, /const KNOCKOUT = /);
  assert.match(review, /KNOCKOUT\.test\(b\.label\) - KNOCKOUT\.test\(a\.label\)/);   // knockouts sorted to the top
  const KNOCKOUT = new RegExp(review.match(/const KNOCKOUT = \/(.*)\/i;/)[1], 'i');
  for (const label of ['Are you authorized to work in the country where the job is located?', 'Will you now or in the future require sponsorship for employment visa status in this country?',
    'Are you able to work from our US office three days per week?', 'Do you hold a valid driving licence?']) assert.ok(KNOCKOUT.test(label), label);
  for (const label of ['Preferred name', 'Why do you want to work here?', 'LinkedIn profile']) assert.ok(!KNOCKOUT.test(label), label);
});

test('the app and the form panel mark the same knockout questions', () => {
  const regex = text => text.match(/const KNOCKOUT = (\/.*\/i);/)[1];
  assert.equal(regex(read('desktop/renderer/knockout.js')), regex(read('extension/review.js')));
});

test('the form panel\'s tip line draws from the same pool as the app (run extension/sync.sh after changing it)', () => {
  assert.equal(read('extension/tips-pool.js'), read('desktop/renderer/tips-pool.js'));
  assert.match(read('extension/background.js'), /message\?\.type === 'panelTip'/);
  assert.match(read('extension/review.js'), /type: 'panelTip'/);
});
