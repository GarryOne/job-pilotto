// The "More · N" component (sidebar and Actions page): count in the title, hidden at 0, closed by default, state remembered per key.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isOpen, moreGroup, moreTitle} from '../renderer/more-group.js';

const store = () => { const map = new Map(); return {getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value)}; };
const parts = () => { const clicks = []; return {root: {hidden: true}, list: {hidden: true}, title: {textContent: ''}, head: {addEventListener: (type, fn) => clicks.push(fn), setAttribute(name, value) { this[name] = value; }, click: () => clicks.forEach(fn => fn())}}; };

test('the title counts, the group is gone at 0, and it starts closed', () => {
  const storage = store(), p = parts();
  const group = moreGroup({...p, key: 'k', storage});
  group.draw(4);
  assert.equal(moreTitle(4), 'More · 4');
  assert.deepEqual([p.root.hidden, p.title.textContent, p.list.hidden, p.head['aria-expanded']], [false, 'More · 4', true, 'false']);
  group.draw(0);
  assert.equal(p.root.hidden, true);
});

test('opening is remembered under its own key, and a second group does not share it', () => {
  const storage = store(), a = parts(), b = parts();
  const first = moreGroup({...a, key: 'menu', storage}), second = moreGroup({...b, key: 'actions', storage});
  first.draw(2); second.draw(3);
  a.head.click();
  assert.equal(a.list.hidden, false);
  assert.equal(isOpen(storage, 'menu'), true);
  assert.equal(b.list.hidden, true);
  const again = parts();   // a later start with the same storage
  moreGroup({...again, key: 'menu', storage}).draw(2);
  assert.equal(again.list.hidden, false);
  a.head.click();
  assert.equal(isOpen(storage, 'menu'), false);
});

test('blocked storage: the group still works, closed', () => {
  const blocked = {getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }}, p = parts();
  moreGroup({...p, key: 'k', storage: blocked}).draw(1);
  assert.equal(p.list.hidden, true);
  p.head.click();   // no throw
});
