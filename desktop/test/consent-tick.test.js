// Consent boxes are ticked for the person by default (owner, 17 Oct 2026); only the AI-read "legal" kind, never a choice, never a statement of fact.
// Guards extension/page/fill-checks.js tickConsents, the flow.js switch and the /extension/me field that carries Settings -> Consent boxes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fakeFillPage} from './fake-fill-page.js';
import {consentOn} from '../renderer/pages/consent-setting.js';

const rows = [
  {field: 'gdpr', label: 'Li e aceito o aviso de privacidade (RGPD)', type: 'checkbox', required: true, filled: false, legal: false},
  {field: 'visa', label: 'Do you need a visa to work here?', type: 'checkbox', required: true, filled: false, legal: false},
  {field: 'truth', label: 'I certify that the information provided is true', type: 'checkbox', required: true, filled: false, legal: false}];
const answers = [{field: 'gdpr', value: 'checked', category: 'legal'}, {field: 'visa', value: '', category: 'knockout'}, {field: 'truth', value: '', category: 'legal'}];

test('consent on: the data notice is ticked in any language; a choice and a certification never are', async () => {
  const {elements, fill} = fakeFillPage(rows, {checkboxes: true});
  await fill(answers, {consents: true});
  assert.equal(elements.gdpr.checked, true);
  assert.equal(elements.visa.checked, false, 'a knockout question is the person\'s choice');
  assert.equal(elements.truth.checked, false, 'a statement of fact about the person is never ticked');
});

test('consent off: nothing is ticked', async () => {
  const {elements, fill} = fakeFillPage(rows, {checkboxes: true});
  await fill(answers, {consents: false});
  assert.deepEqual(Object.values(elements).map(el => el.checked), [false, false, false]);
});

test('the switch is on unless the person turned it off, in the app and in the extension', () => {
  assert.equal(consentOn(undefined), true);
  assert.equal(consentOn({}), true);
  assert.equal(consentOn({acceptConsents: false}), false);
  const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
  assert.equal(flow.match(/\(me\?\.acceptConsents \?\? config\.acceptConsents\) !== false/g).length, 2);
  assert.match(fs.readFileSync(new URL('../lib/server-contact.js', import.meta.url), 'utf8'), /acceptConsents: storage\.settings\(\)\.acceptConsents !== false/);
  assert.match(fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8'), /id="consent-tick"/);
});
