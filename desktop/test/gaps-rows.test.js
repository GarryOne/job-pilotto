// The CV gaps card as a review list (owner review fix 6, mockup 06, 18 Oct 2026): pending skills as rows with Confirm skill / Dismiss, reviewed ones
// folded as "Reviewed · N" and put-backable, the card's own words say what the list is, the Profile's other lines are notes apart from the decisions.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {GAPS_LEAD, gapsBody, pendingCount} = await import('../renderer/gaps-rows.js');
const {lineOf} = await import('../renderer/gaps-model.js');
const all = node => [node, ...(node.children || []).flatMap(each => all(each))];
const part = {lines: [{id: 'a', text: lineOf('Prometheus', 'check')}, {id: 'b', text: lineOf('Go', 'check')}, {id: 'c', text: lineOf('Helm', 'skill')}, {id: 'd', text: lineOf('Vault', 'dropped')}, {id: 'e', text: 'Please confirm or discard each.'}]};
const press = (box, aria) => all(box).find(node => node.getAttribute?.('aria-label') === aria).click();
const rows = (box, cls) => all(box).filter(node => String(node.className).split(' ').includes(cls));

test('every skill to review is a row with Confirm skill and Dismiss; pressing reports the item and the new state', () => {
  const seen = [], box = gapsBody(part, (item, state) => seen.push([item.item, item.id, state]));
  assert.equal(rows(box, 'gap-list')[0].children.length, 2);   // the pending list: the two to check
  assert.equal(pendingCount(part), 2);
  press(box, 'Prometheus: confirm skill');
  press(box, 'Go: dismiss');
  assert.deepEqual(seen, [['Prometheus', 'a', 'skill'], ['Go', 'b', 'dropped']]);
});

test('the card says what the list is (skills to verify, the CV file unchanged) in its own words, in its header, never a lone line above the rows', () => {
  assert.match(GAPS_LEAD, /verify/);
  assert.match(GAPS_LEAD, /CV file is not changed/);
  const box = gapsBody(part, () => {});
  assert.doesNotMatch(box.textContent, /CV file is not changed/);
  assert.equal(box.children[0].className, 'gap-list', 'the rows come first');
});

test('reviewed skills are folded as "Reviewed · N" and can be put back; notes stay apart; empty and all-reviewed say so', () => {
  const seen = [], box = gapsBody(part, (item, state) => seen.push([item.item, state]));
  assert.match(box.textContent, /Reviewed · 2/);
  assert.match(box.textContent, /Helm confirmed · Vault dismissed/);
  assert.match(box.textContent, /Notes in your Profile · 1.*Please confirm or discard each\./s, 'the Profile\'s own lines fold like Reviewed');
  assert.equal(rows(box, 'gap-fold').length, 2);
  press(box, 'Helm: put back');
  assert.deepEqual(seen, [['Helm', 'check']]);
  assert.match(gapsBody({lines: []}, () => {}).textContent, /Not set yet/);
  assert.match(gapsBody({lines: [{id: 'a', text: lineOf('Go', 'skill')}]}, () => {}).textContent, /All reviewed/);
});
