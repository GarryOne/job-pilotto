// The CV gaps card: one chip per gap with ✓ and ✕, answered ones folded away and put-backable; the note stays.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {gapsBody} = await import('../renderer/gaps-rows.js');
const {lineOf} = await import('../renderer/gaps-model.js');
const all = node => [node, ...(node.children || []).flatMap(each => all(each))];
const part = {lines: [{id: 'a', text: lineOf('Prometheus', 'check')}, {id: 'b', text: lineOf('Go', 'check')}, {id: 'c', text: lineOf('Helm', 'skill')}, {id: 'd', text: lineOf('Vault', 'dropped')}, {id: 'e', text: 'Please confirm or discard each.'}]};
const press = (box, aria) => all(box).find(node => node.getAttribute?.('aria-label') === aria).click();

test('every gap to check is a chip with ✓ and ✕; pressing reports the item and the new state', () => {
  const seen = [], box = gapsBody(part, (item, state) => seen.push([item.item, item.id, state]));
  assert.match(box.textContent, /2 to check/);
  press(box, 'Prometheus: I have this skill');
  press(box, 'Go: not a gap');
  assert.deepEqual(seen, [['Prometheus', 'a', 'skill'], ['Go', 'b', 'dropped']]);
});

test('answered gaps are folded and can be put back; the note stays; an empty part says so', () => {
  const seen = [], box = gapsBody(part, (item, state) => seen.push([item.item, state]));
  assert.match(box.textContent, /Confirmed skills \(1\)/);
  assert.match(box.textContent, /Not a gap \(1\)/);
  assert.match(box.textContent, /Please confirm or discard each\./);
  press(box, 'Helm: put back');
  assert.deepEqual(seen, [['Helm', 'check']]);
  assert.match(gapsBody({lines: []}, () => {}).textContent, /Not set yet/);
  assert.match(gapsBody({lines: [{id: 'a', text: lineOf('Go', 'skill')}]}, () => {}).textContent, /All checked/);
});
