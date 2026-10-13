// Expected moves only from what a run confirmed (e2e/lib/ladder-move-labels.mjs, box 7 of spec 2026-10-12-one-next-move.md): an Apply press counts only when the next page-kind answer was a
// form; it is joined to a posting fixture by the page's address without query and to its numbered candidates by their own text; a label no candidate carries is a finding, never a label.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {confirmedPresses, evidenceDirs, labelMoves, numbersFor, runName} from '../e2e/lib/ladder-move-labels.mjs';

const POSTING = 'https://jobs.example.org/job/42?ref=board', FORM = 'https://jobs.example.org/job/42/apply';
const at = iso => Date.parse(iso);
const pressLine = (iso, label, host = 'jobs.example.org') => `${iso} [extension] fill: pressed the Apply button ${JSON.stringify({host, label, tag: 'a', version: '0.9.300'})}`;
function run({calls, log}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-move-labels-')), 'evidence', '2026-10-13', 'example-row');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'ai-calls.json'), JSON.stringify(calls));
  fs.writeFileSync(path.join(dir, 'app.log'), `${log.join('\n')}\n`);
  return dir;
}
const pageCall = (iso, url, kind) => ({route: '/extension/page-kind', at: at(iso), request: {url}, answer: {kind}});
const posting = {id: 'example-posting', source: 'captured', sketch: {url: 'https://jobs.example.org/job/42'}, expect: {outcome: 'posting'},
  candidates: [{n: 1, kind: 'link', text: 'About us'}, {n: 2, kind: 'button', text: 'Apply  NOW'}, {n: 3, kind: 'link', text: 'Apply now'}]};

test('a press counts only when a form came after it, on the page it was pressed on', () => {
  const reached = run({calls: [pageCall('2026-10-13T10:00:00Z', POSTING, 'posting'), pageCall('2026-10-13T10:00:05Z', FORM, 'form')], log: [pressLine('2026-10-13T10:00:01Z', 'Apply now')]});
  assert.deepEqual(confirmedPresses(reached), [{url: POSTING, label: 'Apply now', version: '0.9.300', at: at('2026-10-13T10:00:01Z')}]);
  const stopped = run({calls: [pageCall('2026-10-13T10:00:00Z', POSTING, 'posting'), pageCall('2026-10-13T10:00:05Z', POSTING, 'account')], log: [pressLine('2026-10-13T10:00:01Z', 'Apply now')]});
  assert.deepEqual(confirmedPresses(stopped), [], 'no form after the press: nothing confirmed');
  const otherHost = run({calls: [pageCall('2026-10-13T10:00:00Z', POSTING, 'posting'), pageCall('2026-10-13T10:00:05Z', FORM, 'form')], log: [pressLine('2026-10-13T10:00:01Z', 'Apply now', 'board.example.net')]});
  assert.deepEqual(confirmedPresses(otherHost), [], 'a press on another host is not this page\'s');
  assert.deepEqual(confirmedPresses(path.join(os.tmpdir(), 'jp-no-such-evidence')), []);
});

test('the label is every candidate whose own text is the pressed one; a press no candidate carries is a finding', () => {
  assert.deepEqual(numbersFor(posting.candidates, 'apply now'), [2, 3]);
  const presses = [{url: POSTING, label: 'Apply now', version: '0.9.300'}];
  const {labels, unlisted} = labelMoves([posting], [{run: '2026-10-13/example-row', presses}]);
  assert.deepEqual(labels, [{id: 'example-posting', verb: 'press', candidates: [2, 3], confirmed: {by: 'pool', run: '2026-10-13/example-row', version: '0.9.300'}}]);
  assert.deepEqual(unlisted, []);
  const missing = labelMoves([posting], [{run: '2026-10-13/example-row', presses: [{url: POSTING, label: 'Postuler', version: '0.9.300'}]}]);
  assert.deepEqual(missing.labels, []);
  assert.deepEqual(missing.unlisted, [{id: 'example-posting', label: 'Postuler', run: '2026-10-13/example-row'}]);
  const notPosting = labelMoves([{...posting, expect: {outcome: 'form_in_frame'}}], [{run: 'r', presses}]);
  assert.deepEqual(notPosting, {labels: [], unlisted: []}, 'only a posting\'s move is a press');
});

test('the evidence folders are found under the roots and named <day>/<row>', () => {
  const dir = run({calls: [], log: []});
  const root = path.resolve(dir, '..', '..');
  assert.deepEqual(evidenceDirs([root]), [dir]);
  assert.equal(runName(dir), '2026-10-13/example-row');
});
