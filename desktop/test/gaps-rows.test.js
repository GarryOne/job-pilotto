// The CV gaps card as the shared review list (page-parts.js; owner review fix 6, mockup 06, 18 Oct 2026): pending skills as rows with Confirm skill / Dismiss, reviewed ones
// folded as "Reviewed · N" and put-backable, the card's own words say what the list is, the Profile's other lines are Note rows with no decision; the list is
// in the live-card rows look (owner, 18 Oct 2026) with nothing loose under it: all reviewed is said by the card's header (allReviewed).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {allReviewed, gapsBody, pendingCount} = await import('../renderer/gaps-rows.js');
const {lineOf} = await import('../renderer/gaps-model.js');
const all = node => [node, ...(node.children || []).flatMap(each => all(each))];
const part = {lines: [{id: 'a', text: lineOf('Prometheus', 'check')}, {id: 'b', text: lineOf('Go', 'check')}, {id: 'c', text: lineOf('Helm', 'skill')}, {id: 'd', text: lineOf('Vault', 'dropped')}, {id: 'e', text: 'Please confirm or discard each.'}]};
const press = (box, aria) => all(box).find(node => node.getAttribute?.('aria-label') === aria).click();
const rows = (box, cls) => all(box).filter(node => String(node.className).split(' ').includes(cls));

test('every skill to review is a row with Confirm skill and Dismiss; pressing reports the item and the new state', () => {
  const seen = [], box = gapsBody(part, (item, state) => seen.push([item.item, item.id, state]));
  const pending = rows(box, 'review-items')[0].children;   // the pending list (page-parts.js reviewList): the two to check, then the note
  assert.deepEqual(pending.map(row => row.dataset.key), ['Prometheus', 'Go', 'note-0']);
  assert.equal(all(pending[2]).filter(node => node.tagName === 'BUTTON').length, 0, 'a note is never a decision');
  assert.ok(rows(box, 'is-rows').length, 'the live-card rows look');
  assert.equal(pendingCount(part), 2);
  press(box, 'Prometheus: confirm skill');
  press(box, 'Go: dismiss');
  assert.deepEqual(seen, [['Prometheus', 'a', 'skill'], ['Go', 'b', 'dropped']]);
});

test('the card says what the list is (skills to verify, the CV file unchanged) in its own words, never from the data', () => {
  const text = gapsBody(part, () => {}).textContent;
  assert.match(text, /verify/);
  assert.match(text, /CV file is not changed/);
});

test('reviewed skills are folded as "Reviewed · N" and can be put back; a note is a row; empty says so; all reviewed is the header\'s', () => {
  const seen = [], box = gapsBody(part, (item, state) => seen.push([item.item, state]));
  assert.match(box.textContent, /Reviewed · 2/);
  assert.match(box.textContent, /Helm confirmed · Vault dismissed/);
  assert.match(box.textContent, /Confirmed skill/);
  assert.match(box.textContent, /Dismissed/);
  assert.match(box.textContent, /Please confirm or discard each\./);
  press(box, 'Helm: put back');
  assert.deepEqual(seen, [['Helm', 'check']]);
  assert.match(gapsBody({lines: []}, () => {}).textContent, /Not set yet/);
  const done = {lines: [{id: 'a', text: lineOf('Go', 'skill')}]};
  assert.equal(allReviewed(done), true);
  assert.equal(allReviewed(part), false);
  assert.equal(allReviewed({lines: []}), false);
  assert.doesNotMatch(gapsBody(done, () => {}).textContent, /All reviewed/, 'no loose line under the list');
});
