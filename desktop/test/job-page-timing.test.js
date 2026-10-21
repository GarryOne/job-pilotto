// The drawer opens fast (lib/job-page-handlers.js, renderer/pages/job-panel.js): the core read is one round of store calls, the rest one call, the
// files last; and the Overview is drawn from the list row before any of them answers. A fake store with a per-call delay stands for Notion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {jobCore, jobFilesOf, jobPage, jobRest} from '../lib/job-page-handlers.js';

const DELAY = 120;   // per store call (a Notion round trip is 350 ms; scaled down, the ratios are what is asserted)
function slowStore() {
  const calls = [];
  const call = async (_s, entity, method) => {
    calls.push(`${entity}.${method}`);
    await new Promise(resolve => setTimeout(resolve, DELAY));
    if (entity === 'matches') return {url: 'https://x/1', fit: 80};
    if (method === 'get') return {id: 'a1'};
    if (entity === 'job_page') return {sections: {}, events: [], interviews: []};
    return [];
  };
  return {call, calls};
}
const timed = async work => { const t = Date.now(); const out = await work(); return [out, Date.now() - t]; };

test('the core read is one round, the rest one call: a whole page is three rounds, not seven calls in two', async () => {
  const {call, calls} = slowStore();
  const [core, coreMs] = await timed(() => jobCore({}, 'https://x/1', {call, placesNow: async () => 'p'}));
  assert.equal(core.app.id, 'a1');
  assert.ok(coreMs < DELAY * 2, `core ${coreMs} ms: app and match are asked together`);
  assert.deepEqual(calls.sort(), ['applications.get', 'matches.get']);
  const [, restMs] = await timed(() => jobRest({}, 'a1', {call}));
  assert.ok(restMs < DELAY * 1.8, `rest ${restMs} ms: sections, events and interviews are one engine call`);
  assert.equal(calls.filter(name => name === 'job_page.read').length, 1);
  const [, filesMs] = await timed(() => jobFilesOf({}, 'a1', {call}));
  assert.ok(filesMs < DELAY * 1.8);
  const again = slowStore();
  const [, wholeMs] = await timed(() => jobPage({}, 'https://x/1', {call: again.call, placesNow: async () => 'p'}));
  assert.ok(wholeMs < DELAY * 3.5, `whole page ${wholeMs} ms`);
});

test('the drawer draws the Overview from the list row before the store answers, and the other tabs only once the rest is in', () => {
  const src = fs.readFileSync(new URL('../renderer/pages/job-panel.js', import.meta.url), 'utf8');
  const draw = src.slice(src.indexOf('function draw()'), src.indexOf('function go('));
  assert.match(draw, /state\.tab === 'overview' && \(state\.stage !== 'none' \|\| job\.fit != null\)/, 'a scored row draws its Overview at once');
  assert.match(draw, /state\.stage !== 'full'[\s\S]*skeleton\(\)/, 'the other tabs wait for the rest');
  const load = src.slice(src.indexOf('async function load('), src.indexOf('// Opens (or switches)'));
  const order = ['jobPageCore', 'jobPageRest', 'jobPageFiles'].map(name => load.indexOf(`'${name}'`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'core, then rest, then files');
  assert.ok(order.every(at => at > 0));
  assert.doesNotMatch(load, /window\.pilot\.jobPage\(/, 'no single slow read of everything');
});
