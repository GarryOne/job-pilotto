// The D1 meter (src/d1-meter.js): rows from every query of one request are added up, batch still gets the real statements, and the log line names the route and the caller.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {callerOf, meter, newTally, requestLine, routeOf} from '../src/d1-meter.js';

function fakeDb() {
  const seen = [];
  const statement = sql => ({sql, bind() { return this; }, async run() { return {meta: {rows_read: 3, rows_written: 2}}; }, async all() { return {results: [], meta: {rows_read: 10, rows_written: 0}}; }, async first() { return {n: 1}; }});
  return {seen, prepare: statement, async batch(list) { seen.push(...list.map(item => item.sql)); return list.map(() => ({meta: {rows_read: 1, rows_written: 1}})); }};
}

test('every query of a request adds its rows; first() counts as unmetered; batch receives the real statements', async () => {
  const tally = newTally(), db = meter(fakeDb(), tally);
  await db.prepare('SELECT 1').bind(1).all();
  await db.prepare('INSERT x').bind(2).run();
  await db.prepare('SELECT n').bind().first();
  const raw = fakeDb(), batched = meter(raw, tally);
  await batched.batch([batched.prepare('A').bind(1), batched.prepare('B')]);
  assert.deepEqual(raw.seen, ['A', 'B']);
  assert.deepEqual(tally, {queries: 5, read: 15, written: 4, unmetered: 1});
});

test('a database without batch() still has none after wrapping, because the code branches on it', () => {
  assert.equal(meter({prepare() {}}, newTally()).batch, undefined);
});

test('the caller is the X-Caller word, else the kind of client; the route never carries an id', () => {
  const call = headers => callerOf(new Request('https://x.test/a', {headers}));
  assert.equal(call({'x-caller': 'needs-fix-order'}), 'needs-fix-order');
  assert.equal(call({'x-caller': 'Bad Caller!', 'user-agent': 'curl/8.7.1'}), 'curl');   // anything but a short fixed word is ignored
  assert.equal(call({'user-agent': 'Mozilla/5.0 (Macintosh)'}), 'browser');
  assert.equal(call({'user-agent': 'node'}), 'node');
  assert.equal(routeOf('/admin/lab-form-filling'), '/admin/lab-form-filling');
  assert.equal(routeOf('/api/index/9f8e7d6c5b4a39281716'), '/api/index/:x');
});

test('a request that touched D1 gets one line with its rows; one that did not is silent unless it failed', () => {
  const request = new Request('https://www.jobpilotto.workers.dev/admin/lab-form-filling?json', {headers: {'x-caller': 'page-tab'}});
  const line = JSON.parse(requestLine(request, 200, {queries: 2, read: 40, written: 0, unmetered: 1}));
  assert.deepEqual(line, {kind: 'req', route: '/admin/lab-form-filling', method: 'GET', status: 200, caller: 'page-tab', host: 'www.jobpilotto.workers.dev', queries: 2, rows_read: 40, rows_written: 0, unmetered: 1});
  assert.equal(requestLine(request, 200, newTally()), null);
  assert.ok(requestLine(request, 503, newTally()));
});

test('the Worker wraps every request with the meter, and Workers Logs stay on in the config', () => {
  assert.match(readFileSync(new URL('../src/index.js', import.meta.url), 'utf8'), /meter\(env\.STATS, tally\)/);
  assert.match(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), /\[observability\]\s*\nenabled = true\s*\nhead_sampling_rate = 1/);
});
