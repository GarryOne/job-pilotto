// Strengths in the editor (renderer/strengths-model.js): a group per "Label: values" line as chips; unchanged groups keep their own text; edits, a
// removed chip, an emptied group and a new group become the right block changes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {changesFor} from '../renderer/experience-profile-model.js';
import {draftsOf, textsOf, typedItems} from '../renderer/strengths-model.js';

const part = (...texts) => ({headingId: 'h', lines: texts.map((text, i) => ({id: `l${i}`, text})), rows: [], hints: []});
const DEMO = part('**Cloud:** AWS in depth (EKS, RDS, VPC); some GCP', 'Incidents: on-call leadership, blameless postmortems', 'Calm under pressure.');

test('drafts: groups as chips, a line with no label as its words', () => {
  assert.deepEqual(draftsOf(DEMO), [{index: 0, label: 'Cloud', items: ['AWS in depth (EKS, RDS, VPC)', 'some GCP']},
    {index: 1, label: 'Incidents', items: ['on-call leadership', 'blameless postmortems']}, {index: 2, label: '', items: [], plain: 'Calm under pressure.'}]);
  assert.deepEqual(typedItems('Go, Rust (some)'), ['Go', 'Rust (some)']);
});

test('open and save with no change: no change at all', () => {
  assert.deepEqual(changesFor('strengths', DEMO, textsOf(DEMO, draftsOf(DEMO))), []);
});

test('a chip removed, a chip added, a group emptied, a new group', () => {
  const drafts = draftsOf(DEMO);
  drafts[0].items.pop();
  drafts[0].items.push('Azure');
  drafts[1].items = [];
  drafts.push({index: null, label: 'Languages', items: ['Go', 'Python']});
  assert.deepEqual(changesFor('strengths', DEMO, textsOf(DEMO, drafts)), [
    {op: 'text', id: 'l0', value: '**Cloud:** AWS in depth (EKS, RDS, VPC), Azure', was: DEMO.lines[0].text},
    {op: 'remove', id: 'l1', was: DEMO.lines[1].text},
    {op: 'insert', after: 'l2', lines: ['**Languages:** Go, Python']}]);
});

test('a group renamed keeps its line\'s style (no bold stays no bold)', () => {
  const drafts = draftsOf(DEMO);
  drafts[1].label = 'On call';
  assert.deepEqual(changesFor('strengths', DEMO, textsOf(DEMO, drafts)).map(change => change.value), ['On call: on-call leadership, blameless postmortems']);
});
