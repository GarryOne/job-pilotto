// A box's label when the page's <label for> names no box: the label right before it names it (page/label-before.js), and a class that says "required" counts as required.
// 12 Oct 2026, a French form: "Prénom" / "Nom" labels naming no box, the boxes named surname / name by the page (the wrong way round): "Nom" stayed empty, "Prénom" got the family name,
// and the panel said "No required fields". Two pages, one shape: the capture's own and a variant in other languages, other ids, names, wrappers and tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';

const FLAT = `<form><input type="hidden" name="job_id">
  <label for="civility">Civilité : Mlle / Mme / M</label>
  <input class="validate[required]" type="text" name="JOBAPPLICATION[civility]">
  <div></div>
  <label style="clear:both" for="prenom">Prénom</label>
  <input class="validate[required]" type="text" name="JOBAPPLICATION[surname]" id="form-validation-field-0">
  <div></div>
  <label for="nom">Nom</label>
  <input class="validate[required]" type="text" name="JOBAPPLICATION[name]">
  <div></div>
  <label for="mail">E-mail</label>
  <input class="validate[required,custom[email]]" type="text" name="JOBAPPLICATION[email]" id="form-validation-field-1"></form>`;
// Same shape, everything incidental changed: German and Spanish, each box in its own wrapper, a label ids a box of ANOTHER field, names that point the other way.
const WRAPPED = `<form>
  <p class="q"><label for="x-family">Nachname</label><br><input name="vorname_feld" id="a1" class="is-required"></p>
  <p class="q"><label for="x-given">Vorname</label><span class="hint"></span><input name="familyName" id="a2" aria-required="true"></p>
  <div class="q"><label for="gone">Teléfono</label><div class="wrap"><input name="surname" type="tel" id="a3"></div></div>
  <div class="q"><label for="a4">Notizen</label><textarea name="n" id="a4"></textarea></div></form>`;

const labels = (window) => [...window.document.querySelectorAll('input, textarea')].filter((el) => el.type !== 'hidden').map((el) => window.__jobPilottoFillKit.labelOf(el));

test('the label before a box names it when its `for` names no box (flat form)', { skip }, () => {
  const window = openPage(JSDOM, FLAT);
  assert.deepEqual(labels(window), ['Civilité : Mlle / Mme / M', 'Prénom', 'Nom', 'E-mail']);
  const pairs = Object.fromEntries(['Prénom', 'Nom'].map((label) => [label, window.__jobPilottoFillKit.PROFILE_LABELS.find(([, pattern]) => pattern.test(label))?.[0] || '']));
  assert.equal(pairs['Prénom'], 'first_name', 'a label read as "Prénom" is the first name whatever the box is named');
});

test('variant: other languages, wrappers, tags and names pointing the wrong way', { skip }, () => {
  const window = openPage(JSDOM, WRAPPED);
  assert.deepEqual(labels(window), ['Nachname', 'Vorname', 'Teléfono', 'Notizen']);
  assert.equal(window.__jobPilottoFillKit.PROFILE_LABELS.find(([, pattern]) => pattern.test('Vorname'))[0], 'first_name');
});

test('a label tied to another box is not borrowed, and a label past other text or a box is not either', { skip }, () => {
  const window = openPage(JSDOM, `<form><label for="b">Eins</label><input id="b"><input id="c"> <label>Zwei</label> Text <input id="d"><label for="zz">Drei</label><div><input id="e"><input id="f"></div></form>`);
  const before = (id) => window.__jobPilottoLabelBefore(window.document.getElementById(id));
  assert.equal(before('c'), '', 'the label before it belongs to the box before');
  assert.equal(before('d'), '', 'text sits between');
  assert.equal(before('e'), '', 'a wrapper with two boxes is no one box');
});

test('a class or attribute that says "required" marks the box; a lookalike word does not', { skip }, () => {
  const window = openPage(JSDOM, `<input id="a" class="validate[required]"><input id="b" class="validate[required,custom[email]]"><input id="c" class="is-required"><input id="d" aria-required="true"><input id="e" class="not-requiredish unrequired"><input id="f" class="validate[custom[email]]">`);
  const marked = (id) => window.__jobPilottoRequired.marked(window.document.getElementById(id));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map(marked), [true, true, true, true, false, false]);
});

test('the describe-form read shows both pages\' boxes as required with their labels', { skip }, async () => {
  for (const [html, want] of [[FLAT, ['Prénom', 'Nom']], [WRAPPED, ['Nachname', 'Vorname']]]) {
    const window = openPage(JSDOM, html);
    const rows = (await window.__jobPilottoDescribeForm(false));
    for (const label of want) assert.equal(rows.find((row) => row.label === label)?.required, true, label);
  }
});

test('the Playwright audit reads the same required mark as the panel and the fill (a class that says required)', { skip }, () => {
  const required = (html, id) => openPage(JSDOM, html).__jobPilottoAuditVisibleFields().find((row) => row.field === id)?.required;
  assert.equal(required(FLAT, 'form-validation-field-0'), true, 'validate[required] on a flat form');
  assert.equal(required(FLAT, 'form-validation-field-1'), true, 'validate[required,custom[email]]');
  assert.equal(required(WRAPPED, 'a1'), true, 'is-required');
  assert.equal(required(WRAPPED, 'a2'), true, 'aria-required');
  assert.equal(required(WRAPPED, 'a4'), false, 'a box with no mark stays optional');
});
