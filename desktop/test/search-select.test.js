import test from 'node:test';
import assert from 'node:assert/strict';
import {filterOptions} from '../renderer/search-select.js';

const groups = [{label: '', options: [{value: 'new', text: 'Not in my list yet: a new job'}]},
  {label: 'Your applications', options: [{value: 'a', text: 'Anthropic · Staff Software Engineer (Kit ready)'},
    {value: 'b', text: 'Canonical · Site Reliability Engineer (Rejected)'}]}];

test('every typed word must match, in any order and case; empty groups go', () => {
  assert.deepEqual(filterOptions(groups, ' reliability CANONICAL ').map(g => g.options.map(o => o.value)), [['b']]);
  assert.deepEqual(filterOptions(groups, 'kit staff').map(g => g.label), ['Your applications']);
  assert.deepEqual(filterOptions(groups, 'zzz'), []);
  assert.equal(filterOptions(groups, '').flatMap(g => g.options).length, 3);
});
