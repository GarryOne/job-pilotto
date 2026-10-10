// Per-rung ANSWER contracts of the ladder: whatever a (fake) model replies, good or hostile, what a rung hands on is one of its fixed values and names only what the page itself lists.
// Rungs: 0 structure (tab-pages pageRole), 1-2 page-kind, 3 digest, 4 closer look (escalate), the router (ladder-core). Nothing the model writes as free text may become an action.
// Spec: docs/superpowers/specs/2026-10-10-ai-ladder.md (last box of item 8). Imports of the rung files are guarded in ladder-architecture.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {pageRole} from '../../extension/tab-pages.js';
import {RUNGS, SIGNALS, ladderLine, nextRung} from '../../extension/ladder-core.js';
import {APPLY_BY, KINDS, ROLE, ROUTES, pageKind, pageKindCache} from '../lib/page-kind.js';
import {OUTCOMES, VERBS, askDigest, validateDigest} from '../lib/digest.js';
import {ACTIONS, DETAILS, escalate} from '../lib/escalate.js';

const reply = (answer, extra = {}) => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 500, output_tokens: 20}, ...extra,
  content: [{type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer)}]})}});
const throwing = {messages: {create: async () => { throw new Error('boom <script>alert(1)</script>'); }}};
const lower = list => list.map(text => String(text).toLowerCase());
const cache = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-contract-')), 'kinds.json'));

// ---------------- rung 0: the structure rule
test('rung 0: pageRole answers only form, account or no-form, whatever it is given', () => {
  const inputs = [undefined, null, {}, {fields: '5'}, {fields: NaN, passwords: -1}, {passwords: '1'}, {passwords: 1, files: 1}, {fields: Infinity}, {textareas: {}}, {files: [], fields: ['x']}, {passwords: 1e9}];
  for (const page of inputs) for (const url of [undefined, null, '', 'not a url', 'https://x.example/login', 'javascript:alert(1)', {}]) {
    let got;
    try { got = pageRole(page ?? undefined, url); } catch (error) { assert.fail(`pageRole threw on ${JSON.stringify(page)} ${String(url)}: ${error.message}`); }
    assert.ok(['form', 'account', 'no-form'].includes(got), `pageRole gave ${got}`);
  }
  assert.deepEqual([...new Set(Object.values(ROLE))].sort(), ['account', 'form', 'no-form'], 'the AI rungs map every kind onto the same three roles');
});

// ---------------- rungs 1-2: page-kind
const page = {url: 'https://jobs.example.ch/stelle/12345?token=SECRET', title: 'Projektleiter', headings: ['Ihre Aufgaben'], controls: [{type: 'email', label: 'E-Mail', required: true}],
  buttons: ['Jetzt bewerben', 'Anmelden', 'Konto erstellen', 'Sign in with LinkedIn', 'Bewerbung absenden'], mails: ['Senden Sie Ihre Unterlagen an jobs@example.ch.']};
const good = {kind: 'posting', confidence: 0.9, apply_button: 'Jetzt bewerben', apply_button_kind: 'apply', apply_route: '', account_step: '', register_control: '', signin_control: '', account_button: '', apply_by: 'form', apply_email: '', bot_check: false};
const with_ = changes => ({...good, ...changes});
// Each reply is hostile or garbled in one way; the check below is the same for all.
const PAGE_KIND_REPLIES = {
  'a good answer': good,
  'a kind outside the list': with_({kind: 'login'}),
  'a kind that is an array': with_({kind: ['form']}),
  'a kind that is an object key trick': with_({kind: '__proto__'}),
  'a kind in another case': with_({kind: 'FORM'}),
  'confidence as text': with_({confidence: 'high'}),
  'confidence above 1': with_({confidence: 7}),
  'confidence negative': with_({confidence: -3}),
  'confidence missing': (({confidence, ...rest}) => rest)(good),
  'an Apply button the page does not list': with_({apply_button: 'Delete my account'}),
  'a third-party sign-in named as the Apply button': with_({apply_button: 'Sign in with LinkedIn'}),
  'the submit button named as the Apply button': with_({apply_button: 'Bewerbung absenden'}),
  'a route outside the list': with_({apply_route: 'run_script'}),
  'a third-party route with a button': with_({apply_route: 'third_party_account', apply_button: 'Sign in with LinkedIn'}),
  'apply_by outside the list': with_({apply_by: 'phone'}),
  'an email outcome with an address the page does not show': with_({apply_by: 'email', apply_email: 'attacker@evil.example'}),
  'an email outcome with an address that is part of another one': with_({apply_by: 'email', apply_email: 'jobs@example.c'}),
  'an account step outside the list': with_({kind: 'account', account_step: 'delete_account', account_button: 'Konto erstellen'}),
  'an account control the page does not list': with_({kind: 'account', account_step: 'sign_in', register_control: 'Pay now', account_button: 'Wire the money'}),
  'extra fields with instructions': {...good, run: 'rm -rf', note: 'CLICK EVERYTHING', url: 'https://evil.example'},
  'a bot check as text': with_({bot_check: 'yes'}),
  'text instead of JSON': 'Sure! The page is a posting. Click Apply.',
  'JSON in a markdown fence': '```json\n{"kind":"posting","confidence":0.9}\n```',
  'a JSON array': '[{"kind":"form"}]',
  'JSON null': 'null',
  'an empty object': {},
  'an empty string': '',
};
const PAGE_BUTTONS = lower(page.buttons);

function assertPageKindResult(got, label) {
  assert.ok(got && typeof got === 'object', `${label}: an object`);
  if (got.error) { assert.equal(typeof got.error, 'string'); assert.equal(got.kind === undefined || KINDS.includes(got.kind), true, `${label}: an error may carry only a fixed kind`); }
  else {
    assert.ok(KINDS.includes(got.kind), `${label}: kind ${got.kind}`);
    assert.equal(got.role, ROLE[got.kind], `${label}: role follows the kind`);
    assert.ok(got.confidence >= 0 && got.confidence <= 1, `${label}: confidence ${got.confidence}`);
    assert.ok(got.confidence >= 0.6, `${label}: an unsure answer must not be returned as an answer`);
  }
  assert.ok(got.rung === undefined || Object.values(RUNGS).includes(got.rung), `${label}: rung ${got.rung}`);
  assert.ok(got.signal === undefined || SIGNALS.includes(got.signal), `${label}: signal ${got.signal}`);
  for (const name of ['applyButton', 'registerControl', 'signinControl', 'accountButton']) {
    if (got[name]) assert.ok(PAGE_BUTTONS.includes(got[name].toLowerCase()), `${label}: ${name} "${got[name]}" is not one of the page's buttons`);
  }
  assert.ok(!got.error || (!/SECRET/.test(got.error) && got.error.length <= 120), `${label}: an error is short and never carries the query string`);
  assert.ok(['', undefined, 'manual', ...ROUTES].includes(got.applyRoute), `${label}: route ${got.applyRoute}`);
  assert.ok(['', undefined, ...APPLY_BY].includes(got.applyBy), `${label}: apply_by ${got.applyBy}`);
  assert.ok(['', undefined, 'sign_in', 'sign_up', 'choose'].includes(got.accountStep), `${label}: account step ${got.accountStep}`);
  if (got.applyEmail) assert.ok(page.mails.some(line => line.toLowerCase().includes(got.applyEmail.toLowerCase())) && got.applyEmail.toLowerCase().split('@')[1] === 'example.ch', `${label}: address "${got.applyEmail}" is not on the page`);
  const flat = JSON.stringify(got);
  assert.ok(!/CLICK EVERYTHING|rm -rf|evil\.example|Delete my account|Pay now|Wire the money/.test(flat), `${label}: free text from the model reached the result: ${flat}`);
}

test('rungs 1-2: whatever the model replies, page-kind returns a fixed kind, role, route, outcome and only controls the page lists', async () => {
  for (const [label, answer] of Object.entries(PAGE_KIND_REPLIES)) assertPageKindResult(await pageKind(reply(answer), page, cache()), label);
  assertPageKindResult(await pageKind(reply(good, {stop_reason: 'max_tokens'}), page, cache()), 'a cut-off reply');
  assertPageKindResult(await pageKind(throwing, page, cache()), 'a client that throws');
  assertPageKindResult(await pageKind(null, page, cache()), 'no client');
});

// The floor for "which button is the Apply button" is the AI's judgment of what the button DOES (apply_button_kind, any language), ANDed with the shared word floor (validateAlias), never the words alone
// (found 10 Oct 2026: "Sign up", "Continue with Google", "Anmelden", "Se connecter" passed the English-partial list). A model that does not judge it, or judges anything but `apply`, leaves no Apply button.
const NOT_APPLY = {'Sign up': 'sign_up', 'Continue with Google': 'third_party', 'Anmelden': 'sign_in', 'Se connecter': 'sign_in', 'Registrieren': 'sign_up', 'Konto erstellen': 'sign_up', 'Sign in with LinkedIn': 'third_party'};
const wide = {...page, buttons: [...page.buttons, ...Object.keys(NOT_APPLY)]};
test('rungs 1-2: a sign-in, sign-up or third-party control is never kept as the Apply button', async () => {
  for (const [name, kind] of Object.entries(NOT_APPLY)) {
    const got = await pageKind(reply(with_({apply_button: name, apply_button_kind: kind})), wide, cache());
    assert.equal(got.applyButton || '', '', `"${name}" judged ${kind} was kept as the Apply button`);
  }
});
test('rungs 1-2: no judgment of the button (missing, empty, other) keeps no Apply button; apply keeps it', async () => {
  const noKind = {...good}; delete noKind.apply_button_kind;
  for (const answer of [noKind, with_({apply_button_kind: ''}), with_({apply_button_kind: 'other'}), with_({apply_button_kind: 'Apply'}), with_({apply_button_kind: 'click me'})])
    assert.equal((await pageKind(reply(answer), wide, cache())).applyButton, '', JSON.stringify(answer.apply_button_kind));
  assert.equal((await pageKind(reply(good), wide, cache())).applyButton, 'jetzt bewerben');
  // AND, never OR: the AI's `apply` does not lift the shared floor (a button it does not list, a submit).
  for (const name of ['Delete my account', 'Bewerbung absenden']) assert.equal((await pageKind(reply(with_({apply_button: name})), wide, cache())).applyButton, '', name);
});

test('rungs 1-2: a hostile kept answer is not trusted either (a kept kind outside the list is asked again)', async () => {
  const kept = cache();
  const shapeKey = (await pageKind(reply(good), page, kept)).shape;
  kept.set(shapeKey, {kind: 'run_script', confidence: 1});
  const got = await pageKind(reply(good), page, kept);
  assertPageKindResult(got, 'a poisoned kept answer');
  assert.notEqual(got.by, 'remembered');
});

test('rungs 1-2: an unsure answer climbs (signal unsure, rung 2) and is never kept for the shape', async () => {
  const kept = cache(), got = await pageKind(reply(with_({confidence: 0.3})), page, kept);
  assert.equal(got.signal, 'unsure');
  assert.equal(got.rung, 2);
  assert.equal(kept.get(got.shape), null);
});

// ---------------- rung 3: the numbered digest
const candidates = [
  {n: 1, kind: 'sentence', text: 'Senden Sie Ihre Unterlagen an jobs@example.ch.', position: 'main'},
  {n: 2, kind: 'email', text: 'jobs@example.ch', position: 'main'},
  {n: 3, kind: 'phone', text: 'Rufen Sie an: 044 000 00 00', position: 'main'},
  {n: 4, kind: 'button', text: 'Jetzt bewerben', position: 'main'},
  {n: 5, kind: 'link', text: 'Zum Portal', host: 'apply.example.net', position: 'main'},
  {n: 6, kind: 'sentence', text: 'Diese Stelle ist besetzt.', position: 'main'},
  {n: 7, kind: 'link', text: 'Impressum', position: 'footer'},
];
const dig = (outcome, verb, numbers, extra = {}) => ({outcome, verb, numbers, confidence: 0.9, ...extra});
const DIGEST_REPLIES = {
  'a number outside the candidates': dig('form', 'press', [99]),
  'a number that is zero': dig('form', 'press', [0]),
  'a negative number': dig('form', 'press', [-4]),
  'a fractional number': dig('form', 'press', [4.5]),
  'numbers as strings': dig('form', 'press', ['4']),
  'a number as a bare value': dig('form', 'press', 4),
  'too many numbers': dig('expired', 'tell_person', [1, 2, 3, 4, 5]),
  'press on a sentence': dig('form', 'press', [6]),
  'press on an email': dig('form', 'press', [2]),
  'press with two numbers': dig('form', 'press', [4, 5]),
  'press with an outcome that is not form or link': dig('expired', 'press', [4]),
  'open on a button': dig('link', 'open', [4]),
  'open on a link without a host': dig('link', 'open', [7]),
  'an email outcome without an email candidate': dig('email', 'tell_person', [6]),
  'a phone outcome on a sentence': dig('phone', 'tell_person', [6]),
  'an outcome without any candidate': dig('email', 'tell_person', []),
  'none with numbers': dig('other', 'none', [4]),
  'a verb outside the list': dig('form', 'click_everything', [4]),
  'a verb in another case': dig('form', 'PRESS', [4]),
  'an outcome outside the list': dig('hacked', 'press', [4]),
  'an outcome that is an array': dig(['form'], 'press', [4]),
  'extra fields': {...dig('form', 'press', [4]), action: 'submit', text: 'CLICK EVERYTHING'},
  'confidence as text': dig('form', 'press', [4], {confidence: 'sure'}),
  'confidence above 1': dig('form', 'press', [4], {confidence: 12}),
  'text instead of JSON': 'press 4 please',
  'JSON null': 'null',
  'an empty object': {},
  'a good press': dig('form', 'press', [4]),
  'a good open': dig('link', 'open', [5]),
  'a good email': dig('email', 'tell_person', [1, 2]),
  'a good expired': dig('expired', 'tell_person', [6]),
};
const KIND_OF = new Map(candidates.map(item => [item.n, item]));

function assertDigest(got, label) {
  assert.ok(OUTCOMES.includes(got.outcome), `${label}: outcome ${got.outcome}`);
  assert.ok(VERBS.includes(got.verb), `${label}: verb ${got.verb}`);
  assert.ok(Array.isArray(got.numbers) && got.numbers.length <= 4 && got.numbers.every(number => KIND_OF.has(number)), `${label}: numbers ${JSON.stringify(got.numbers)}`);
  assert.deepEqual(got.chosen.map(item => item.n), got.numbers, `${label}: chosen are the page's own candidates, in order`);
  for (const item of got.chosen) assert.deepEqual(item, KIND_OF.get(item.n), `${label}: a chosen candidate is exactly the page's own`);
  assert.ok(got.confidence >= 0 && got.confidence <= 1, `${label}: confidence ${got.confidence}`);
  if (got.verb === 'press') assert.ok(got.numbers.length === 1 && ['button', 'link'].includes(got.chosen[0].kind) && ['form', 'link'].includes(got.outcome), `${label}: press only a button or link`);
  if (got.verb === 'open') assert.ok(got.numbers.length === 1 && got.chosen[0].kind === 'link' && got.chosen[0].host, `${label}: open only a link with a host`);
  if (got.verb === 'tell_person') assert.ok(got.numbers.length >= 1, `${label}: tell_person quotes something`);
  if (got.verb === 'none') assert.deepEqual(got.numbers, [], `${label}: none names nothing`);
  if (['email', 'phone'].includes(got.outcome) && !got.dropped) assert.ok(got.chosen.some(item => item.kind === got.outcome), `${label}: ${got.outcome} stands on a candidate of that kind`);
  assert.ok(!/CLICK EVERYTHING|submit/.test(JSON.stringify({...got, chosen: undefined, raw: undefined})), `${label}: free text reached the answer`);
}

test('rung 3: validateDigest accepts only fixed outcomes and verbs, and numbers that are the page\'s own candidates of the right kind', () => {
  for (const [label, answer] of Object.entries(DIGEST_REPLIES)) if (typeof answer === 'object') assertDigest(validateDigest(answer, candidates), label);
  for (const junk of [undefined, null, 5, 'press', [], () => 1]) assertDigest(validateDigest(junk, candidates), `junk ${String(junk)}`);
  assertDigest(validateDigest(dig('form', 'press', [4]), []), 'no candidates at all');
  assert.equal(validateDigest(dig('form', 'press', [4]), []).verb, 'none');
});

// HOLE (minor): a dropped answer keeps the model's unverified outcome (verb none, `dropped` set); pageKind ignores it, but a caller reading `outcome` alone would trust "email" with no address behind it.
test('rung 3: a dropped answer does not carry an outcome that stands on nothing', {todo: 'hole: validateDigest keeps outcome email when tell_person has no number'}, () => {
  for (const answer of [dig('email', 'tell_person', []), dig('phone', 'none', []), dig('email', 'none', [])]) {
    const got = validateDigest(answer, candidates);
    if (got.dropped) assert.ok(!['email', 'phone'].includes(got.outcome), `${got.outcome} survives in a dropped answer (${got.dropped})`);
  }
});

test('rung 3: the good replies are accepted and every hostile one becomes verb none with a reason', () => {
  for (const [label, answer] of Object.entries(DIGEST_REPLIES)) {
    if (typeof answer !== 'object') continue;
    const got = validateDigest(answer, candidates);
    if (label.startsWith('a good')) assert.equal(got.dropped, undefined, `${label} was dropped: ${got.dropped}`);
    else if (!['confidence as text', 'confidence above 1', 'extra fields'].includes(label)) assert.equal(got.verb, 'none', `${label} was accepted as ${got.verb}`);
  }
});

test('rung 3: through the client, text instead of JSON, a cut-off reply, a throwing client and no client are errors, never answers', async () => {
  for (const [label, answer] of Object.entries(DIGEST_REPLIES)) {
    const got = await askDigest(reply(answer), {path: '/x', title: 't', headings: []}, candidates);
    if (got.error) { assert.equal(typeof got.error, 'string'); assert.ok(got.error.length <= 120, `${label}: a long error`); } else assertDigest(got, label);
  }
  assert.ok((await askDigest(reply(DIGEST_REPLIES['a good press'], {stop_reason: 'max_tokens'}), {}, candidates)).error);
  assert.ok((await askDigest(throwing, {}, candidates)).error);
  assert.ok((await askDigest(null, {}, candidates)).error);
});

test('rung 3: through page-kind, a digest result is a posting, carries only the page\'s own candidates and never the model\'s words', async () => {
  const withCandidates = {...page, candidates};
  for (const [label, answer] of Object.entries(DIGEST_REPLIES)) {
    const got = await pageKind(reply(answer), withCandidates, cache(), {digest: true});
    if (got.error) { assert.ok(got.rung === 3 && SIGNALS.includes(got.signal) && got.signal !== 'confident', `${label}: a failed digest says rung 3 and a non-confident signal`); continue; }
    assert.equal(got.kind, 'posting', `${label}`);
    assert.equal(got.rung, 3);
    assert.equal(got.signal, 'confident');
    assertDigest({...got.digest, confidence: got.confidence}, label);
    assert.ok(!('raw' in got) && !JSON.stringify(got).includes('CLICK EVERYTHING'), `${label}: the model's raw reply must not travel on`);
    if (got.applyEmail) assert.ok(candidates.some(item => item.kind === 'email' && item.text === got.applyEmail), `${label}: the address is a candidate's own text`);
  }
  assert.equal((await pageKind(reply(DIGEST_REPLIES['a good press']), page, cache(), {digest: true})).error, 'no candidates');
});

// ---------------- rung 4: the closer look (escalate)
const sketch = {url: 'https://karriere.example/career', title: 'Anmelden', headings: [], controls: [
  {type: 'text', label: 'E-Mail', required: true, state: 'empty', at: '50,30'},
  {type: 'text', label: 'Vorname', required: true, state: 'filled', at: '50,40'},
  {type: 'password', label: 'Passwort', required: true, state: 'empty', at: '50,50'},
  {type: 'select-one', label: 'Land', required: true, state: 'empty', at: '50,60', options: ['Schweiz', 'Deutschland']}],
  buttons: ['Anmelden', 'Noch kein Profil? Hier registrieren', 'Bewerbung absenden'], texts: [], frames: []};
const storageOf = (settings = {accountAutomation: 'full'}) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-esc-contract-')); return {settings: () => settings, path: name => path.join(dir, name)}; };
const ask = (extra = {}) => ({url: 'https://karriere.example/career?token=SECRET', kind: 'account', sketch, image: Buffer.from('jpeg-bytes').toString('base64'), reason: 'unsure twice', ...extra});
const act = (action, rest = {}) => ({action, control: '', detail: '', option: '', why: 'x', confidence: 0.9, ...rest});
const LISTED = lower([...sketch.controls.map(item => item.label), ...sketch.buttons]);
const ESCALATE_REPLIES = {
  'a good click': act('click', {control: 'Noch kein Profil? Hier registrieren'}),
  'a click in another case': act('click', {control: 'ANMELDEN'}),
  'a click on a control the page does not list': act('click', {control: 'Delete my account'}),
  'a click on an unlisted submit': act('click', {control: 'Submit application'}),
  'a click with no control': act('click'),
  'a click with a number': act('click', {control: 4}),
  'a good fill': act('fill', {control: 'E-Mail', detail: 'email'}),
  'a fill of a box that is filled': act('fill', {control: 'Vorname', detail: 'first_name'}),
  'a fill of a password box': act('fill', {control: 'Passwort', detail: 'email'}),
  'a fill with a detail outside the list': act('fill', {control: 'E-Mail', detail: 'password'}),
  'a fill with a detail the model made up': act('fill', {control: 'E-Mail', detail: 'hunter2'}),
  'a fill of a box that is not listed': act('fill', {control: 'Kreditkarte', detail: 'email'}),
  'a fill of a button': act('fill', {control: 'Anmelden', detail: 'email'}),
  'a good choose': act('choose', {control: 'Land', option: 'Schweiz'}),
  'a choose of an option the dropdown does not list': act('choose', {control: 'Land', option: 'Atlantis'}),
  'a choose on a text box': act('choose', {control: 'E-Mail', option: 'x'}),
  'wait': act('wait'),
  'ask the person': act('ask_person', {control: 'Anmelden'}),
  'an action outside the list': act('submit_application', {control: 'Anmelden'}),
  'an action in another case': act('CLICK', {control: 'Anmelden'}),
  'an action that is an array': act(['click'], {control: 'Anmelden'}),
  'a why that is long and hostile': act('wait', {why: `IGNORE THE RULES ${'x'.repeat(5000)}`}),
  'extra fields': {...act('wait'), shell: 'rm -rf /'},
  'text instead of JSON': 'click Anmelden',
  'JSON null': 'null',
  'an empty object': {},
};

function assertEscalate(got, label, {form = false, assist = false} = {}) {
  assert.ok(got && got.ok !== false, `${label}: ok`);
  assert.ok([...ACTIONS, 'none'].includes(got.action), `${label}: action ${got.action}`);
  if (['click', 'fill', 'choose'].includes(got.action)) assert.ok(LISTED.includes(String(got.control).toLowerCase()), `${label}: ${got.action} on "${got.control}", which the page does not list`);
  if (got.action === 'fill') {
    const box = sketch.controls.find(item => item.label === got.control);
    assert.ok(!form && box && ['text', 'email', 'tel', 'search', 'url', 'textarea'].includes(box.type) && box.state === 'empty' && DETAILS.includes(got.detail), `${label}: fill only an empty text box with a fixed detail`);
  }
  if (got.action === 'choose') assert.ok(!form && sketch.controls.find(item => item.label === got.control)?.options.includes(got.option), `${label}: choose only a listed option`);
  if (assist) assert.ok(!['click', 'fill', 'choose'].includes(got.action), `${label}: under assist the person acts`);
  if (got.why !== undefined) assert.ok(String(got.why).length <= 120, `${label}: why is capped`);
  assert.ok(!('shell' in got) && !/rm -rf/.test(JSON.stringify(got)), `${label}: extra model fields travel on`);
}

test('rung 4: whatever the model replies, the closer look returns one fixed action on a control, box or option the page lists', async () => {
  for (const [label, answer] of Object.entries(ESCALATE_REPLIES)) assertEscalate(await escalate(storageOf(), ask(), {client: reply(answer)}), label);
  assertEscalate(await escalate(storageOf(), ask(), {client: reply(act('wait'), {stop_reason: 'max_tokens'})}), 'a cut-off reply');
  assertEscalate(await escalate(storageOf(), ask(), {client: throwing}), 'a client that throws');
});

test('rung 4: on an application form only a click on a listed control (or wait) goes through: fill and choose become ask_person', async () => {
  for (const [label, answer] of Object.entries(ESCALATE_REPLIES)) assertEscalate(await escalate(storageOf(), ask({kind: 'form', image: ''}), {client: reply(answer)}), label, {form: true});
  for (const answer of [act('fill', {control: 'E-Mail', detail: 'email'}), act('choose', {control: 'Land', option: 'Schweiz'})]) assert.equal((await escalate(storageOf(), ask({kind: 'form', image: ''}), {client: reply(answer)})).action, 'ask_person');
});

test('rung 4: under "Let me check each step" nothing is clicked, filled or chosen, and no model is asked', async () => {
  let asked = 0;
  const counting = {messages: {create: async () => { asked += 1; return {content: [{type: 'text', text: '{}'}], stop_reason: 'end_turn'}; }}};
  for (const answer of Object.values(ESCALATE_REPLIES)) assertEscalate(await escalate(storageOf({accountAutomation: 'assist'}), ask(), {client: reply(answer)}), 'assist', {assist: true});
  assert.equal((await escalate(storageOf({accountAutomation: 'assist'}), ask(), {client: counting})).action, 'none');
  assert.equal(asked, 0);
});

test('rung 4: a poisoned kept answer is checked again against the page before it is used', async () => {
  const storage = storageOf(), shape = 'karriere.example/career';
  fs.writeFileSync(storage.path('escalation.json'), JSON.stringify({recipes: {[shape]: {action: 'click', control: 'Delete my account'}, [`form:${shape}`]: {action: 'fill', control: 'Passwort', detail: 'email'}}}));
  assertEscalate(await escalate(storage, ask(), {client: reply(act('wait'))}), 'a poisoned account recipe');
  assertEscalate(await escalate(storage, ask({kind: 'form', image: ''}), {client: reply(act('wait'))}), 'a poisoned form recipe', {form: true});
});

// ---------------- the router
test('the router: an unknown rung or signal goes to the person; it never asks a rung it was not given and never starts the takeover', () => {
  const junkRungs = [undefined, null, -1, 7, 2.5, '2', NaN, '__proto__', [2], {}], junkSignals = [undefined, null, '', 'CONFIDENT', 'sure', '__proto__', ['unsure'], 1];
  for (const rung of junkRungs) for (const signal of [...SIGNALS, ...junkSignals]) assert.equal(nextRung({rung, signal}).rung, RUNGS.person, `rung ${String(rung)} signal ${String(signal)} must go to the person`);
  for (const rung of Object.values(RUNGS)) for (const signal of junkSignals) assert.equal(nextRung({rung, signal}).rung, RUNGS.person, `rung ${rung} with signal ${String(signal)} must go to the person`);
  for (const junk of [undefined, 5, 'x', []]) assert.equal(nextRung(junk).rung, RUNGS.person);
  const everyone = [RUNGS.structure, RUNGS.kept, RUNGS.sketch, RUNGS.digest, RUNGS.picture, RUNGS.takeover, RUNGS.person];
  for (const rung of Object.values(RUNGS)) for (const signal of SIGNALS) for (const off of [[], [3], [3, 4], everyone, ['3', 'x']]) for (const capped of [[], [4], everyone, [null]]) {
    const next = nextRung({rung, signal, off, capped});
    assert.ok(Object.values(RUNGS).includes(next.rung), `a known rung comes back (${rung}/${signal})`);
    if (rung !== RUNGS.takeover) assert.notEqual(next.rung, RUNGS.takeover, 'the router never starts the takeover');
    if (next.climbed) assert.ok(next.rung > rung || next.rung === RUNGS.person, 'a climb goes up, or to the person');
    if (next.climbed && next.rung !== RUNGS.person && next.rung !== rung) assert.ok(!off.includes(next.rung) && !capped.includes(next.rung), 'a rung that is off or capped is never asked');
  }
});

test('the router: the log line is exactly "ladder: rung N signal S" for a known, non-confident answer and empty for everything else', () => {
  for (const rung of Object.values(RUNGS)) for (const signal of SIGNALS) assert.equal(ladderLine({rung, signal}), signal === 'confident' ? '' : `ladder: rung ${rung} signal ${signal}`);
  for (const junk of [{rung: 9, signal: 'unsure'}, {rung: 2, signal: 'boom <b>'}, {rung: '2', signal: 'unsure'}, {}, undefined]) assert.equal(ladderLine(junk), '', JSON.stringify(junk));
});

// HOLE (minor): the default `= {}` covers undefined only, so a null argument throws instead of going to the person (invariant 4: an unknown input is never guessed).
test('the router: a null argument goes to the person instead of throwing', () => {
  assert.equal(nextRung(null).rung, RUNGS.person);
  assert.equal(ladderLine(null), '');
});
