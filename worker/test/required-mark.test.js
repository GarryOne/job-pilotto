// The required mark: a label that ends "Label*:", "Label *:" or "Label* :" (table forms, older ATS pages, German/French forms) is required.
// Every reader asks the one helper (extension/page/required-mark.js), so the panel, the fill and the coverage agree.
// 10 Oct 2026, live: a Migros/umantis form marked six questions "Anrede*:" and the panel said "No required fields".
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
// A table form: the question is a text cell, the radio options sit in the next cell; labels end "*:".
const TABLE = `<form><table>
  <tr><td>Anrede*:</td><td><input type="radio" name="sal" id="s1"><label for="s1">Frau</label>
    <input type="radio" name="sal" id="s2"><label for="s2">Herr</label></td></tr>
  <tr><td><label for="fn">Vorname *:</label></td><td><input id="fn"></td></tr>
  <tr><td><label for="em">E-Mail-Adresse/Login*:</label></td><td><input id="em" type="email"></td></tr>
  <tr><td><label for="ph">Telefon:</label></td><td><input id="ph"></td></tr>
</table></form>`;

test('the helper sees a mark before a trailing colon, and none where there is none', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, TABLE);
  const mark = window.__jobPilottoRequired;
  assert.ok(mark, 'page/required-mark.js is injected');
  for (const text of ['Anrede*:', 'Vorname *:', 'E-Mail*: ', 'Name *', 'Nom* :', 'Name ∗', 'Name＊：', '* Name']) assert.equal(mark.has(text), true, text);
  for (const text of ['Telefon:', 'Mit * markierte Felder sind Pflichtfelder.', 'Notes (optional)', '']) assert.equal(mark.has(text), false, text);
  assert.equal(mark.clean('Anrede*:'), 'Anrede');
  assert.equal(mark.clean('Vorname *:'), 'Vorname');
  assert.equal(mark.clean('Telefon:'), 'Telefon');
});

test('a "Label*:" form lists its required question that cannot be read, and counts the others', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, TABLE);
  const summary = await window.__jobPilottoExtensionFill([{ field: 'fn', value: 'Ada', source: 'kit' }, { field: 'em', value: 'ada@example.test', source: 'kit' }], {}, null, '', false);
  const left = Array.from(summary.trace).filter((r) => r.outcome === 'left' && r.required);
  assert.ok(left.some((r) => /Anrede/.test(r.label)), `Anrede is listed as a required question left: ${JSON.stringify(left.map((r) => r.label))}`);
  assert.equal(Array.from(summary.trace).find((r) => /Telefon/.test(r.label))?.required, false, 'Telefon stays optional');
  assert.ok(summary.unfilledRequired >= 1);
});

test('the independent star count sees the starred labels, not the legend, and no other text', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, `<p>Mit * markierte Felder sind Pflichtfelder.</p>${TABLE}`);
  assert.equal(window.__jobPilottoRequired.starred(window.document), 3);   // Anrede, Vorname, E-Mail: the legend and "Telefon:" are not
  const plain = openPage(JSDOM, '<form><label for="a">Name</label><input id="a"></form>');
  assert.equal(plain.__jobPilottoRequired.starred(plain.document), 0);
});
