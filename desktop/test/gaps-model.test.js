// CV gaps as one line per gap with its state (owner, 17 Oct 2026, review M7: "one chip per gap with ✓ / ✕, kept in the same store"): to check, a confirmed skill, or not a gap.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {STATES, lineOf, readLine, readLines, setState} from '../renderer/gaps-model.js';

test('a gap is one line with its state, the same text on every store; only a line the app wrote is read', () => {
  assert.equal(lineOf('Prometheus', 'check'), 'Prometheus (CV gap: to check)');
  assert.deepEqual(readLine('Prometheus (CV gap: confirmed skill)'), {item: 'Prometheus', state: 'skill'});
  assert.deepEqual(readLine('- **Argo CD** (CV gap: not a gap)'), {item: 'Argo CD', state: 'dropped'});
  assert.equal(readLine('Prometheus, Go, Argo CD: please confirm or discard each'), null, 'a paragraph is not a gap line');
  for (const state of Object.keys(STATES)) assert.equal(readLine(lineOf('Go', state)).state, state);
});

test('the lines read into gaps (with ids) and other lines; setState rewrites one line', () => {
  const lines = [{id: 'a', text: lineOf('Go', 'check')}, {id: 'b', text: 'Please confirm or discard each.'}, {id: 'c', text: lineOf('Helm', 'skill')}];
  const read = readLines(lines);
  assert.deepEqual(read.items.map(each => [each.id, each.item, each.state]), [['a', 'Go', 'check'], ['c', 'Helm', 'skill']]);
  assert.deepEqual(read.other.map(each => each.id), ['b']);
  assert.equal(setState(lines[0].text, 'skill'), 'Go (CV gap: confirmed skill)');
  assert.equal(readLines([]).items.length, 0);
});

test('the CV gaps card exists only when the Profile has the section, and sits on the Experience tab', async () => {
  const {profileParts, partsOn} = await import('../renderer/experience-profile-model.js');
  const items = (heading, ...texts) => [{id: 'h', type: 'heading_2', text: heading}, ...texts.map((text, i) => ({id: `p${i}`, type: 'paragraph', text}))];
  assert.deepEqual(partsOn(profileParts(items('Strengths', 'Cloud: AWS')), 'experience').map(each => each.key), ['summary', 'strengths', 'education']);
  const found = partsOn(profileParts(items('❓ Possible CV gaps', 'Prometheus, Go. Please confirm or discard each.')), 'experience').find(each => each.key === 'gaps');
  assert.equal(found.part.lines.length, 1);
});
