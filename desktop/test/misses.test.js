// The Mac's list of controls the form reader could not read (lib/misses.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KEEP_DAYS, MAX_ENTRIES, merge, record} from '../lib/misses.js';

const item = (fingerprint, extra = {}) => ({fingerprint, kind: 'toggle-group', skeleton: {t: 'div', a: {}, c: [], k: []}, question: 'Are you authorized to work here?', ...extra});
const DAY = 86400000, now = Date.UTC(2026, 9, 2);

test('the same fingerprint is one entry that counts visits, sites and questions', () => {
  let {list, fresh} = merge([], {host: 'jobs.ashbyhq.com', items: [item('abc123')]}, now);
  assert.equal(fresh, 1);
  ({list, fresh} = merge(list, {host: 'other.example', items: [item('abc123', {question: 'Sponsorship?'})]}, now + 1000));
  assert.equal(fresh, 0);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].count, list[0].hosts, list[0].questions], [2, ['jobs.ashbyhq.com', 'other.example'], ['Are you authorized to work here?', 'Sponsorship?']]);
});

test('bad fingerprints and oversized skeletons are refused; old entries expire; the list is capped', () => {
  const huge = {t: 'div', a: {}, c: ['x'.repeat(7000)], k: []};
  assert.equal(merge([], {items: [item('NOT VALID!'), item('abc123', {skeleton: huge})]}, now).list.length, 0);
  const old = {fingerprint: 'old111', kind: 'x', skeleton: null, firstSeen: now - 40 * DAY, lastSeen: now - (KEEP_DAYS + 1) * DAY, count: 1, hosts: [], questions: []};
  assert.deepEqual(merge([old], {items: []}, now).list, []);
  const many = Array.from({length: MAX_ENTRIES + 5}, (_, i) => ({...old, fingerprint: `fp${String(i).padStart(4, '0')}`, lastSeen: now - i}));
  assert.equal(merge(many, {items: []}, now).list.length, MAX_ENTRIES);
});

test('recording writes the list to the Mac and survives a broken file', () => {
  const files = {};
  const storage = {readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  assert.deepEqual(record(storage, {host: 'a.example', items: [item('abc123')]}, now), {ok: true, fresh: 1});
  assert.equal(JSON.parse(files['misses.json']).length, 1);
  files['misses.json'] = '{broken';
  assert.equal(record(storage, {items: [item('def456')]}, now).ok, true);
});
