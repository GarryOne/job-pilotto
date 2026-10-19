// The panel's Tailor answer per job page (lib/tailor-status.js), and the class rule: every panel control that asks the app goes through ask() (progress + failure on the panel).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setStatus, statusOf, isRunning, forgetAll} from '../lib/tailor-status.js';

test('a status is found by the posting, the form below it, and a #fragment', () => {
  forgetAll();
  setStatus(['https://jobs.example.com/p/1', 'https://jobs.example.com/p/1/application#x'], {state: 'running'});
  assert.equal(statusOf('https://jobs.example.com/p/1/').state, 'running');
  assert.equal(statusOf('https://jobs.example.com/p/1/application').state, 'running');
  assert.equal(statusOf('https://other.example.com/p/2'), null);
  assert.ok(isRunning(['https://jobs.example.com/p/1']));
  setStatus(['https://jobs.example.com/p/1'], {state: 'failed', error: 'x'});
  assert.equal(isRunning(['https://jobs.example.com/p/1']), false);
});

// Controls that show their own progress and failure (Fill: its step row and "Couldn't fill"; Review answer: its card; Take over / Claude auto: off). A new asking control must join ask() or this list.
const OWN = new Set(['panelFill', 'panelReviewAnswer', 'panelTakeOver', 'panelClaudeAuto', 'panelTip', 'panelGoTab', 'panelReload', 'panelStepNow', 'panelBuild', 'panelJob', 'panelAllowed', 'panelCloseTab', 'panelFillOne', 'panelShowTab', 'panelCloseTab']);
test('every panel control that asks the app goes through ask(), which says progress and failure on the panel', () => {
  const root = new URL('../../extension/', import.meta.url);
  const sources = fs.readdirSync(root).filter(f => /^(review|panel-.*)\.js$/.test(f)).map(f => fs.readFileSync(new URL(f, root), 'utf8'));
  const sent = new Set(sources.flatMap(text => [...text.matchAll(/send\(\{type: '(panel\w+)'/g)].map(m => m[1])));
  const viaAsk = new Set(sources.flatMap(text => [...text.matchAll(/ask\([^\n]*?\{type: (?:addMode \? 'panelAddJob' : )?'(panel\w+)'/g)].map(m => m[1])));
  assert.deepEqual([...viaAsk].sort(), ['panelOpenApp', 'panelTailor'], 'the asking controls found');
  assert.ok(sources.join('\n').includes("'panelAddJob'"));
  for (const type of sent) assert.ok(OWN.has(type), `${type} asks the app straight from the panel: route it through ask() or show its own progress/failure, then list it in OWN`);
});
