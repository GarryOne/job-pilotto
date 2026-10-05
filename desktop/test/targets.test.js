// Where a notification click leads (renderer/targets.js, lib/run-history.js notice): only fixed, known destinations, and one for every finished task.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean, plan, VIEWS} from '../renderer/targets.js';
import {notice} from '../lib/run-history.js';

test('a target keeps only the fixed keys, with known pages and sections', () => {
  assert.deepEqual(clean({view: 'jobs', job: ' abc123 '}), {view: 'jobs', job: 'abc123'});
  assert.deepEqual(clean({view: 'settings', section: 'profile'}), {view: 'settings', section: 'profile'});
  assert.deepEqual(clean({run: '42'}), {run: 42});
  assert.deepEqual(clean({activity: true}), {activity: true});
  assert.equal(clean({view: 'jobs', evil: 'x', run: undefined}).evil, undefined);
});

test('an unknown page, section or an empty target opens nothing', () => {
  for (const bad of [null, undefined, 'jobs', 5, {}, {view: 'admin'}, {view: 'jobs', section: 'profile'}, {run: 'abc'}, {run: ''}, {run: null}, {job: '  '}, {activity: 'yes'}]) {
    const result = clean(bad);
    assert.ok(result === null || (result.section === undefined && result.view !== 'admin'), JSON.stringify(bad));
  }
  assert.equal(clean({view: 'admin'}), null);
  assert.equal(clean({view: 'jobs', section: 'profile'}).section, undefined);   // a section belongs to Settings only
  assert.deepEqual(plan(null), []);
});

test('the window takes the steps in a fixed order: the result or panel, then the page, its section, then the job', () => {
  assert.deepEqual(plan({run: 7}), ['run:7']);
  assert.deepEqual(plan({view: 'jobs', job: 'k1'}), ['view:jobs', 'job:k1']);
  assert.deepEqual(plan({view: 'settings', section: 'profile'}), ['view:settings', 'section:profile']);
  assert.deepEqual(plan({activity: true}), ['activity']);
  assert.ok(VIEWS.includes('focus') && VIEWS.includes('interviews'));
});

test('every finished background task notification opens its own result', () => {
  const kinds = ['search', 'scout', 'insight', 'interviewInsight', 'weekly', 'kits', 'today', 'interview', 'rejection', 'prep', 'add', 'import', 'prepare'];
  for (const kind of kinds) {
    const done = notice({id: 1001, kind, ok: true, result: 'ok', new: 3});
    assert.deepEqual(done?.target, {run: 1001}, `${kind} done`);
    const failed = notice({id: 1002, kind, ok: false});
    assert.deepEqual(failed?.target, {run: 1002}, `${kind} failed`);
  }
  assert.deepEqual(notice({id: 5, kind: 'mail', ok: true, updates: ['a', 'b']}).target, {run: 5});
  assert.deepEqual(notice({id: 6, ok: true, new: 0}).target, {run: 6});   // a Jobs check with no kind
  assert.equal(notice({id: 7, kind: 'mail', ok: true}), null, 'a Gmail check that recorded nothing says nothing');
});
