// What kind of page is this (lib/page-kind.js): the AI decides from a sketch in any language, among fixed kinds; kept per page shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {KINDS, ROLE, kindKey, pageBuild, pageKind, pageKindCache, pageShape, pageSketch} from '../lib/page-kind.js';

const fake = (answer, calls = []) => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 600, output_tokens: 20},
  content: [{type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer)}]}; }}});
const coop = {url: 'https://career2.successfactors.eu/careers?company=Coop&token=secret', title: 'Postuler', headings: ['Êtes-vous déjà inscrit ?'],
  controls: [{type: 'file', label: 'CV et diplômes', required: true}, {type: 'email', label: 'E-mail', required: true}, {type: 'password', label: 'Choisissez un mot de passe', required: true}],
  buttons: ['Envoyer']};
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));

test('each posting of a site is one shape; the query string never counts', () => {
  assert.equal(pageShape('https://live.solique.ch/manor/job/details/4080388/'), 'live.solique.ch/manor/job/details/*');
  assert.equal(pageShape('https://live.solique.ch/manor/job/details/4080999/?utm=x'), 'live.solique.ch/manor/job/details/*');
  assert.equal(pageShape('https://career2.successfactors.eu/careers?company=Coop'), 'career2.successfactors.eu/careers');
  assert.equal(pageShape('not a url'), '');
});

test('the AI sees a sketch in the page\'s own language, never typed values or the query string', async () => {
  const calls = [];
  const sketch = pageSketch({...coop, controls: [...coop.controls, {type: 'text', label: 'Prénom', value: 'Igor'}]});
  assert.equal(sketch.path, '/careers');
  assert.equal(JSON.stringify(sketch).includes('Igor'), false);
  await pageKind(fake({kind: 'account-form', confidence: 0.9}, calls), coop, cacheIn());
  const sent = calls[0].messages[0].content;
  assert.match(sent, /file · CV et diplômes · required/);
  assert.equal(sent.includes('secret'), false);
});

test('an answer is kept per shape: asked once, remembered after; its role is what the flows go by', async () => {
  const calls = [], cache = cacheIn();
  const first = await pageKind(fake({kind: 'account-form', confidence: 0.92}, calls), coop, cache);
  assert.deepEqual([first.kind, first.role, first.by], ['account-form', 'form', 'ai']);
  assert.ok(first.usd >= 0);
  const again = await pageKind(fake({kind: 'account', confidence: 1}, calls), {...coop, url: 'https://career2.successfactors.eu/careers?company=Migros'}, cache);
  assert.deepEqual([again.kind, again.by, calls.length], ['account-form', 'remembered', 1]);
});

test('no AI, an unknown word, a low confidence or a failure: no kind, the structure rule decides, nothing kept', async () => {
  const cache = cacheIn();
  assert.equal((await pageKind(null, coop, cache)).error, 'no AI');
  assert.equal((await pageKind(fake({kind: 'login', confidence: 1}), coop, cache)).error, 'not a kind');
  assert.match((await pageKind(fake({kind: 'form', confidence: 0.3}), coop, cache)).error, /unsure/);
  assert.equal((await pageKind(fake('not json'), coop, cache)).error, 'not JSON');
  assert.equal((await pageKind({messages: {create: async () => { throw new Error('overloaded'); }}}, coop, cache)).error, 'overloaded');
  assert.equal(cache.get(kindKey(coop)), null);
});

test('every kind maps to a role the flows know', () => {
  for (const kind of KINDS) assert.ok(['form', 'account', 'no-form'].includes(ROLE[kind]), kind);
});

test('the same address shape built differently is asked again: a job page with the form, another with only an Apply link', async () => {
  const calls = [], cache = cacheIn();
  const form = {url: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Engineer', controls: [{type: 'text', label: 'First'}, {type: 'text', label: 'Last'}, {type: 'email', label: 'Email'}, {type: 'file', label: 'Resume'}], buttons: ['Submit']};
  const posting = {url: 'https://boards.greenhouse.io/other/jobs/2', title: 'Engineer', headings: ['About the role'], controls: [], buttons: ['Apply']};
  assert.notEqual(pageBuild(form.controls), pageBuild(posting.controls));
  await pageKind(fake({kind: 'form', confidence: 0.9}, calls), form, cache);
  const second = await pageKind(fake({kind: 'posting', confidence: 0.9}, calls), posting, cache);
  assert.deepEqual([second.kind, second.by, calls.length], ['posting', 'ai', 2]);
  // A second job page built like the first: remembered.
  const third = await pageKind(fake({kind: 'posting', confidence: 0.9}, calls), {...form, url: 'https://boards.greenhouse.io/acme/jobs/3'}, cache);
  assert.deepEqual([third.kind, third.by, calls.length], ['form', 'remembered', 2]);
});

test('self-correction: a kept kind the page contradicted is dropped, and the next visit asks again', async () => {
  const {forgetPageKind} = await import('../lib/page-kind.js');
  const calls = [], cache = cacheIn();
  const form = {url: 'https://jobs.example.org/apply/7', controls: [{type: 'text', label: 'Nom'}, {type: 'email', label: 'Courriel'}, {type: 'file', label: 'CV'}], buttons: ['Envoyer']};
  await pageKind(fake({kind: 'posting', confidence: 0.8}, calls), form, cache);           // wrong, and kept
  assert.equal((await pageKind(fake({kind: 'form', confidence: 0.9}, calls), form, cache)).by, 'remembered');
  assert.ok(forgetPageKind(cache, form));
  const again = await pageKind(fake({kind: 'form', confidence: 0.9}, calls), form, cache);
  assert.deepEqual([again.kind, again.by, calls.length], ['form', 'ai', 2]);
  assert.equal(forgetPageKind(cache, {url: 'https://nothing.example/x'}), '');               // nothing kept: nothing dropped
});

test('a posting in any language: the AI names its Apply button among the page\'s own buttons, kept with the kind; never one it does not show', async () => {
  const {applyButtonOf} = await import('../lib/page-kind.js');
  const posting = {url: 'https://emprego.example/oferta/123', title: 'Programador Python', headings: ['Programador Python'], controls: [],
    buttons: ['Partilhar', 'Guardar', 'Candidatar-me', 'Iniciar sessão']};
  const cache = cacheIn(), calls = [];
  const answer = await pageKind(fake({kind: 'posting', confidence: 0.9, apply_button: 'Candidatar-me'}, calls), posting, cache);
  assert.equal(answer.applyButton, 'candidatar-me');
  assert.equal((await pageKind(fake({}), posting, cache)).applyButton, 'candidatar-me');   // remembered with the kind: no second call
  assert.equal(calls.length, 1);
  assert.equal(applyButtonOf('Apply on our new site', posting.buttons), '', 'not a button of this page');
  assert.equal(applyButtonOf('Iniciar sessão', ['Iniciar sessão']), 'iniciar sessão');   // a sign-in in Portuguese: the schema's floor knows English words only…
  assert.equal(applyButtonOf('Sign in', ['Sign in']), '', '…and never accepts the English ones');
  assert.equal(applyButtonOf('Submit', ['Submit']), '');
});

test('a button by meaning: the app picks among the page\'s own buttons only, kept; nothing outside them', async () => {
  const {pickChoice} = await import('../lib/server-pages.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-pick-'));
  const storage = {readText: name => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return null; } }, writeText: (name, text) => fs.writeFileSync(path.join(dir, name), text)};
  const options = ['Aceitar todos', 'Rejeitar não essenciais', 'Saber mais'];
  const said = choice => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify({choice})}]})}});
  assert.equal((await pickChoice(storage, {label: 'A cookie banner', value: 'Reject all cookies that are not necessary', options}, {client: said('Rejeitar não essenciais')})).choice, 'Rejeitar não essenciais');
  assert.equal((await pickChoice(storage, {label: 'A cookie banner', value: 'Accept cookies', options}, {client: said('Sign in')})).choice, '', 'never a button the page does not show');
  assert.equal((await pickChoice(storage, {value: 'x', options: []}, {client: said('x')})).choice, '');
});

test('an account page in any language: the AI names the step, the register control and the submit button among the page\'s own controls, kept with the kind', async () => {
  const signIn = {url: 'https://karriere.example/career', title: 'Anmelden', headings: ['Mit bestehendem Profil anmelden'], controls: [{type: 'text', label: 'E-Mail-Adresse', required: true}, {type: 'password', label: 'Kennwort', required: true}],
    buttons: ['Anmelden', 'Kennwort vergessen?', 'Noch kein Profil? Hier registrieren', 'FR']};
  const cache = cacheIn(), calls = [];
  const answer = await pageKind(fake({kind: 'account', confidence: 0.95, account_step: 'sign_in', register_control: 'Noch kein Profil? Hier registrieren', account_button: 'Anmelden'}, calls), signIn, cache);
  assert.deepEqual([answer.kind, answer.accountStep, answer.registerControl, answer.accountButton], ['account', 'sign_in', 'Noch kein Profil? Hier registrieren', 'Anmelden']);
  const again = await pageKind(fake({}), signIn, cache);
  assert.deepEqual([again.by, again.accountStep, again.registerControl, again.accountButton, calls.length], ['remembered', 'sign_in', 'Noch kein Profil? Hier registrieren', 'Anmelden', 1]);
  // a control the page does not show is never kept; a sign-up page has no register control; a posting has no account step at all
  const fabricated = await pageKind(fake({kind: 'account', confidence: 0.9, account_step: 'sign_up', register_control: 'Sign up now', account_button: 'Create it'}), {...signIn, url: 'https://other.example/join'}, cacheIn());
  assert.deepEqual([fabricated.accountStep, fabricated.registerControl, fabricated.accountButton], ['sign_up', '', '']);
  const posting = await pageKind(fake({kind: 'posting', confidence: 0.9, apply_button: '', account_step: 'sign_in', register_control: 'Anmelden', account_button: 'Anmelden'}), {...signIn, url: 'https://x.example/job/1'}, cacheIn());
  assert.deepEqual([posting.accountStep, posting.registerControl, posting.accountButton], ['', '', '']);
});

test('a sign-up page: the AI also names the control that leads to signing in; a sign-in page has none; a control the page does not show is dropped', async () => {
  const signUp = {url: 'https://karriere.example/join', title: 'Konto anlegen', headings: ['Konto anlegen'], controls: [{type: 'email', label: 'E-Mail', required: true}, {type: 'password', label: 'Kennwort', required: true}],
    buttons: ['Konto anlegen', 'Bereits registriert? Melde dich hier an.']};
  const got = await pageKind(fake({kind: 'account', confidence: 0.95, account_step: 'sign_up', register_control: 'Konto anlegen', signin_control: 'Bereits registriert? Melde dich hier an.', account_button: 'Konto anlegen'}), signUp, cacheIn());
  assert.deepEqual([got.accountStep, got.registerControl, got.signinControl], ['sign_up', '', 'Bereits registriert? Melde dich hier an.']);
  const made = await pageKind(fake({kind: 'account', confidence: 0.95, account_step: 'sign_up', signin_control: 'Log in somewhere else', register_control: '', account_button: ''}), {...signUp, url: 'https://other.example/join'}, cacheIn());
  assert.equal(made.signinControl, '');
});

test('a notice page that an account exists: the AI says choose and names the sign-in control, not the reset', async () => {
  const notice = {url: 'https://karriere.example/career', title: 'Konto', headings: [], controls: [], buttons: ['Anmelden', 'E-Mail über Kennwortrücksetzung senden']};
  const got = await pageKind(fake({kind: 'account', confidence: 0.9, account_step: 'choose', register_control: '', signin_control: 'Anmelden', account_button: ''}), notice, cacheIn());
  assert.deepEqual([got.kind, got.accountStep, got.signinControl], ['account', 'choose', 'Anmelden']);
});

test('a remembered page kind is logged once per page shape every 10 minutes; an AI answer, a new kind or another shape always', async () => {
  const {kindWorthSaying, KIND_SAID_MS} = await import('../lib/server-pages.js');
  const said = new Map(), at = 1_000_000;
  const kept = {by: 'remembered', shape: 'jobs.example/careers|p1-2', kind: 'account'};
  assert.equal(kindWorthSaying(kept, said, at), true);                         // first time: said
  assert.equal(kindWorthSaying(kept, said, at + 22_000), false);               // the page asked again 22 s later: quiet
  assert.equal(kindWorthSaying({...kept, kind: 'form'}, said, at + 30_000), true);   // the kind changed: said
  assert.equal(kindWorthSaying({...kept, shape: 'other|p1'}, said, at + 30_000), true);
  assert.equal(kindWorthSaying({...kept, by: 'ai'}, said, at + 31_000), true);  // an AI answer (it may have cost): always
  assert.equal(kindWorthSaying({...kept, kind: 'form'}, said, at + 30_000 + KIND_SAID_MS + 1), true);   // after 10 minutes: said again
});

// SmartRecruiters (twin, 9 Oct 2026): after "Jetzt bewerben" the page was web components (text in shadow roots) and a frame from a bot-check service.
// The sketch was empty, the AI was never asked ("empty page"), and the person was never told a check stood in front of the form.
test('a page with only a frame is still asked; a bot check in front of it is the AI\'s word, said, and never kept for the shape', async () => {
  const check = {url: 'https://jobs.smartrecruiters.com/oneclick-ui/company/x/publication/123', title: 'Einfach Bewerben', headings: [], controls: [], buttons: [],
    frames: ['geo.captcha-delivery.com']};
  const calls = [], cache = cacheIn();
  const first = await pageKind(fake({kind: 'other', confidence: 0.9, apply_button: '', account_step: '', register_control: '', signin_control: '', account_button: '', bot_check: true}, calls), check, cache);
  assert.equal(calls.length, 1, 'asked, not "empty page"');
  assert.match(JSON.stringify(calls[0].messages), /Frames: geo\.captcha-delivery\.com/);
  assert.deepEqual([first.kind, first.role, first.botCheck], ['other', 'no-form', true]);
  const second = await pageKind(fake({kind: 'form', confidence: 0.95, apply_button: '', account_step: '', register_control: '', signin_control: '', account_button: '', bot_check: false}, calls), check, cache);
  assert.deepEqual([second.kind, second.by, calls.length], ['form', 'ai', 2], 'the form behind the solved check is judged fresh, not remembered as other');
  assert.equal((await pageKind(fake({kind: 'other', confidence: 1}), {...check, frames: []}, cacheIn())).error, 'empty page', 'nothing at all: still not asked');
  assert.deepEqual(pageSketch({...check, frames: ['a.example', '', 'b.example']}).frames, ['a.example', 'b.example']);
});

// The start dialog (Workday "Start Your Application", 10 Oct 2026): a step that offers several ways to begin. The AI names the ROUTE of the button it
// picked (fixed answers); the code keeps the button only for the manual route, only among the page's own buttons, and never keeps this passing step for the shape.
test('a start dialog: only the manual route keeps its button; reuse and third-party sign-in never do, whatever the AI says', async () => {
  const {ROUTES} = await import('../lib/page-kind.js');
  const dialog = {url: 'https://richemont.wd3.myworkdayjobs.com/en-US/External/job/Geneva/Buyer_R123', title: 'Buyer', headings: ['Start Your Application'], controls: [],
    buttons: ['Apply Manually', 'Use My Last Application', 'Apply With LinkedIn']};
  const answers = {manual: 'Apply Manually', reuse_previous: 'Use My Last Application', third_party_account: 'Apply With LinkedIn'};
  assert.deepEqual([...ROUTES], Object.keys(answers));   // a new route needs a row here
  for (const [route, button] of Object.entries(answers)) {
    const cache = cacheIn();
    const got = await pageKind(fake({kind: 'posting', confidence: 0.95, apply_button: button, apply_route: route}), dialog, cache);
    assert.equal(got.applyRoute, route);
    assert.equal(got.applyButton, route === 'manual' ? 'apply manually' : '', route);
    assert.equal(cache.get(kindKey(dialog)), null, `${route}: a passing step is never kept for the shape`);
  }
  const outside = await pageKind(fake({kind: 'posting', confidence: 0.95, apply_button: 'Apply Manually', apply_route: 'something_else'}), dialog, cacheIn());
  assert.equal(outside.applyRoute, '', 'a route outside the fixed answers is dropped');
  const notListed = await pageKind(fake({kind: 'posting', confidence: 0.95, apply_button: 'Apply by hand', apply_route: 'manual'}), dialog, cacheIn());
  assert.equal(notListed.applyButton, '', 'a button the page does not show is never named');
  const plain = await pageKind(fake({kind: 'posting', confidence: 0.95, apply_button: 'Apply Manually', apply_route: ''}), dialog, cacheIn());
  assert.equal(plain.applyRoute, '');
});

test('fresh: a kept answer is not used (the page changed after a press); the instructions and schema carry the route', async () => {
  const posting = {url: 'https://jobs.example/job/1', title: 'Job', headings: ['Job'], controls: [], buttons: ['Apply', 'Apply Manually']};
  const cache = cacheIn(), calls = [];
  await pageKind(fake({kind: 'posting', confidence: 0.9, apply_button: 'Apply', apply_route: ''}, calls), posting, cache);
  await pageKind(fake({kind: 'posting', confidence: 0.9, apply_button: 'Apply Manually', apply_route: 'manual'}, calls), posting, cache, {fresh: true});
  assert.equal(calls.length, 2, 'fresh asks again');
  assert.equal((await pageKind(fake({}), posting, cache)).applyButton, 'apply', 'the kept answer is still the plain Apply');
  assert.ok(calls[0].output_config.format.schema.required.includes('apply_route'));
  assert.deepEqual(calls[0].output_config.format.schema.properties.apply_route.enum, ['manual', 'reuse_previous', 'third_party_account', '']);
  assert.match(calls[0].system, /apply_route/);
});

// A posting that is not applied to through a form: "apply by email" is the first outcome (docs/superpowers/specs/2026-10-10-non-form-outcomes.md).
// The AI names how to apply (apply_by) and the address; the address is kept only when the page's own sketch carries it (text or mailto), never guessed.
const emailPages = {
  de: {url: 'https://firma.ch/jobs/senior-ingenieur-4711', title: 'Senior Ingenieur | Firma AG', headings: ['Bewerbung'], buttons: ['Zurück'], mails: ['Senden Sie Ihre Bewerbung an jobs@firma.ch']},
  fr: {url: 'https://entreprise.ch/emplois/ingenieur-12', title: 'Ingénieur logiciel', headings: ['Postuler'], buttons: ['Retour'], mails: ['mailto:rh@entreprise.ch', 'Envoyez votre dossier à rh@entreprise.ch']},
  en: {url: 'https://small.co.uk/careers/analyst-3', title: 'Analyst', headings: ['About the role'], buttons: ['Home'], mails: ['Applications: careers@small.co.uk']},
};
for (const [language, page] of Object.entries(emailPages)) {
  test(`an email posting (${language}): the answer names how to apply and the address, and it is kept per shape`, async () => {
    const address = page.mails.join(' ').match(/[\w.-]+@[\w.-]+\.\w+/)[0], calls = [];
    const got = await pageKind(fake({kind: 'posting', confidence: 0.9, apply_by: 'email', apply_email: address}, calls), page, cacheIn());
    assert.deepEqual([got.applyBy, got.applyEmail], ['email', address]);
    assert.match(calls[0].messages[0].content, new RegExp(address.replace(/\./g, '\\.')));   // the AI sees the sentence that carries it
  });
}
test('an address the page does not carry is dropped and reported, never guessed', async () => {
  const got = await pageKind(fake({kind: 'posting', confidence: 0.9, apply_by: 'email', apply_email: 'hr@elsewhere.com'}), emailPages.de, cacheIn());
  assert.deepEqual([got.applyBy, got.applyEmail, got.dropped], ['other', '', 'apply_email']);
});
test('apply_by is a fixed answer: an unknown value, or email on a form page, is no outcome', async () => {
  assert.equal((await pageKind(fake({kind: 'posting', confidence: 0.9, apply_by: 'carrier pigeon'}), emailPages.de, cacheIn())).applyBy, '');
  assert.equal((await pageKind(fake({kind: 'form', confidence: 0.9, apply_by: 'email', apply_email: 'jobs@firma.ch'}), emailPages.de, cacheIn())).applyBy, '');
});
test('the sketch carries only short sentences with an address, capped, never the body', () => {
  const sketch = pageSketch({...emailPages.de, mails: Array.from({length: 9}, (_, i) => `x${i}@a.ch ${'y'.repeat(300)}`)});
  assert.ok(sketch.mails.length <= 5 && sketch.mails.every(line => line.length <= 160));
});

test('an email next to an Apply button keeps both: the extension presses the button first and reports the email only when no form came', async () => {
  const page = {...emailPages.de, buttons: ['Apply', 'Zurück']};
  const got = await pageKind(fake({kind: 'posting', confidence: 0.9, apply_button: 'Apply', apply_by: 'email', apply_email: 'jobs@firma.ch'}), page, cacheIn());
  assert.deepEqual([got.applyButton, got.applyBy, got.applyEmail], ['apply', 'email', 'jobs@firma.ch']);
});
test('an email outcome is about this posting: it is not kept for the page shape', async () => {
  const cache = cacheIn(), calls = [];
  await pageKind(fake({kind: 'posting', confidence: 0.9, apply_by: 'email', apply_email: 'jobs@firma.ch'}, calls), emailPages.de, cache);
  await pageKind(fake({kind: 'posting', confidence: 0.9, apply_by: 'form'}, calls), {...emailPages.de, url: 'https://firma.ch/jobs/other-9999'}, cache);
  assert.equal(calls.length, 2);
});

test('a kept posting is asked again on a page that carries an address (a later email-only posting of a shape once cached as a plain posting), a kept form is not', async () => {
  const cache = cacheIn(), calls = [];
  const plain = {...emailPages.de, mails: []};
  await pageKind(fake({kind: 'posting', confidence: 0.9, apply_by: 'form'}, calls), plain, cache);
  assert.equal(calls.length, 1);
  await pageKind(fake({kind: 'posting', confidence: 0.9}, calls), plain, cache);
  assert.equal(calls.length, 1, 'without an address the kept answer is used');
  const got = await pageKind(fake({kind: 'posting', confidence: 0.9, apply_by: 'email', apply_email: 'jobs@firma.ch'}, calls), {...emailPages.de, url: 'https://firma.ch/jobs/senior-ingenieur-9999'}, cache);
  assert.deepEqual([calls.length, got.by, got.applyBy], [2, 'ai', 'email']);
  const formCache = cacheIn(), formCalls = [];
  await pageKind(fake({kind: 'form', confidence: 0.9}, formCalls), plain, formCache);
  await pageKind(fake({kind: 'form', confidence: 0.9}, formCalls), emailPages.de, formCache);
  assert.equal(formCalls.length, 1, 'a form page carrying an address (a contact line) costs no second AI call');
});
