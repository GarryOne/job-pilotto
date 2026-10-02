// Keeping what the app learned from forms honest: the studied-fields cache follows the extension version, and a note that keeps
// failing is dropped (lib/learn.js studiedFor, judge).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judge, knowledgeKey, studiedFor} from '../lib/learn.js';

test('the studied fields are only trusted for the extension version that studied them', () => {
  const settings = {formKnowledgeVersion: '0.8.80', formKnowledgeStudied: {'a.test': ['city']}};
  assert.deepEqual(studiedFor(settings, '0.8.80'), {'a.test': ['city']});
  assert.deepEqual(studiedFor(settings, '0.8.81'), {});
  assert.deepEqual(studiedFor(settings, ''), {'a.test': ['city']});  // version unknown: leave it be
  assert.deepEqual(studiedFor({}, '0.8.81'), {});
});

const note = {scope: 'boards.example.com', kind: 'option', field: 'How did you hear', value: 'Careers Website', note: 'x'};
const run = outcome => ({url: 'https://boards.example.com/j/1', trace: [{label: 'How did you hear *', outcome}]});

test('a note is dropped after three fills in a row that left its field empty, not before', () => {
  let stats = {};
  for (let i = 1; i <= 2; i++) {
    const verdict = judge(run('left'), [note], stats);
    assert.equal(verdict.drop.length, 0);
    stats = verdict.stats;
  }
  const verdict = judge(run('left'), [note], stats);
  assert.deepEqual(verdict.drop.map(d => [d.note.field, d.misses, d.site]), [['How did you hear', 3, 'boards.example.com']]);
  assert.deepEqual(verdict.stats, {});
});

test('a fill that works resets the count; other sites, other kinds and fields not on the form are left alone', () => {
  const key = knowledgeKey(note);
  assert.deepEqual(judge(run('filled'), [note], {[key]: {hit: 0, miss: 2}}).stats, {[key]: {hit: 1, miss: 0}});
  assert.equal(judge({url: 'https://other.test/x', trace: run('left').trace}, [note], {}).changed, false);
  assert.equal(judge(run('left'), [{...note, kind: 'widget', value: ''}], {}).changed, false);
  assert.equal(judge({url: run('left').url, trace: []}, [note], {}).changed, false);
  assert.equal(judge(run('left'), [{...note, scope: 'any'}], {}).changed, true);
});
