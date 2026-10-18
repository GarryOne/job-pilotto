// Your details on the Profile page's one save bar (pages/details-drafts.js, renderer/details-count.js; owner, 18 Oct 2026, UI redesign D2): the bar counts the
// fields that differ from what was read or saved, a refresh never draws over drafts, a proposal from the CV is a draft (never saved by itself), and nothing
// on the tab has its own Save any more.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {contactNow, countContact, countFacts} = await import('../renderer/details-count.js');
const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('contact: one change per box that differs; full_name is not a box', async () => {
  const {el} = await import('../renderer/components.js');
  const box = el('div');
  for (const [key, value] of [['first_name', 'Alex'], ['email', ' alex@example.com '], ['phone', ''], ['full_name', 'Alex Morgan']]) {
    const input = el('input'); input.dataset.contact = key; input.value = value; box.append(input);
  }
  const now = contactNow(box);
  assert.deepEqual(now, {first_name: 'Alex', email: 'alex@example.com', phone: ''});
  assert.equal(countContact({first_name: 'Alex', email: 'alex@example.com'}, now), 0);
  assert.equal(countContact({first_name: 'Sam', email: 'alex@example.com', phone: '+44'}, now), 2);
});

test('facts: a changed line is one change, an added or removed line one', () => {
  const saved = {languages: [{label: 'English', value: 'B2'}, {label: 'Russian', value: 'B1'}], eligibility: [{label: 'Switzerland', value: 'B permit'}]};
  assert.equal(countFacts(saved, structuredClone(saved)), 0);
  assert.equal(countFacts(saved, {...saved, languages: [{label: 'English', value: 'C1'}, {label: 'Russian', value: 'B1'}]}), 1);
  assert.equal(countFacts(saved, {...saved, languages: [...saved.languages, {label: 'German', value: 'A2'}]}), 1);
  assert.equal(countFacts(saved, {...saved, eligibility: []}), 1);
});

test('wiring: both sources on the Profile bar, a refresh never draws over drafts, a CV proposal is only a draft', () => {
  const drafts = read('pages/details-drafts.js'), profile = read('pages/profile.js'), facts = read('pages/details-facts.js'), proposals = read('pages/contact-proposals.js');
  assert.match(drafts, /bar\.register\(\{id: 'details-contact', tab: 'details'/);
  assert.match(drafts, /bar\.register\(\{id: 'details-facts', tab: 'details'/);
  assert.match(profile, /if \(!kept && painted && contactDirty\(\)\) return;/);
  assert.match(facts, /if \(!kept && !redrawing && factsDirty\(\)\) return;/);
  assert.match(proposals, /detailsChanged\(\);   \/\/ they are drafts/);
  assert.doesNotMatch(proposals, /saveContact/, 'a proposal never saves by itself');
  const html = read('index.html');
  for (const gone of ['contact-savebar', 'contact-save"', 'contact-discard']) assert.ok(!html.includes(`id="${gone.replace('"', '')}"`), `#${gone} is gone: the page bar saves`);
});
