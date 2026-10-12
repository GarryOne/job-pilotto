// After a write that changes a job's stage (renderer/job-writes.js): the list is read again and painted from the store, a read older than the write
// is never painted, and every stage write in the window and in the engine goes through it (the class, not one case).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {jobWrites} from '../renderer/job-writes.js';
import {isStuck} from '../renderer/jobs-view.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const URL_A = 'https://jobs.example.test/a';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
// A fake store: each read answers when the test says, with the stage the store holds at that moment.
function fakeStore(stage) {
  const store = {stage, reads: [], painted: []};
  store.read = () => { const answer = deferred(); store.reads.push(answer); return answer.promise; };
  store.answer = (index, at = store.stage) => store.reads[index].resolve({jobs: [{url: URL_A, title: 'SRE', stage: at, status: 'applied'}]});
  store.writes = jobWrites({read: store.read, paint: fresh => store.painted.push(fresh)});
  return store;
}
const noSession = () => false;

// 12 Oct 2026, the owner's app.log: a job-list read started 14:56:15, the Cancel's write landed 14:56:37, the read ended 14:56:45 with the old
// stage, and the cancelled job showed "still marked Applying but has no open session".
test('a read that began before a write is never painted; the read after it is', async () => {
  const store = fakeStore('Applying');
  const before = store.writes.read();
  store.stage = 'Kit ready';   // the session's Cancel wrote it
  const reread = store.writes.changed();
  store.answer(0, 'Applying');   // the old read ends after the write
  assert.equal(await before, null, 'the old answer is dropped');
  await Promise.resolve();
  store.answer(1);
  await reread;
  assert.deepEqual(store.painted.map(fresh => fresh.jobs[0].stage), ['Kit ready']);
});

// Cancel, Skip and Close (submitted or not) all end a session; the job its address could not find must still leave Applying.
for (const [action, landed] of [['Cancel', 'Kit ready'], ['Skip', 'Dismissed'], ['Close, not submitted', 'Kit ready'], ['Close, submitted', 'Applied']]) {
  test(`${action}: the job no session explains is not left Applying, even when the session's address finds no job`, async () => {
    const store = fakeStore('Applying');
    assert.equal(isStuck({url: URL_A, stage: 'Applying'}, noSession), true, 'positive control: the stale row is what the banner counts');
    store.stage = landed;
    const reread = store.writes.changed(null);   // sessionJob(item) found nothing: no row to patch
    store.answer(0);
    await reread;
    const job = store.painted.at(-1).jobs[0];
    assert.equal(job.stage, landed);
    assert.equal(isStuck(job, noSession), false);
  });
}

test('the row the action came from shows the change at once, before the store answers', () => {
  const store = fakeStore('Applying');
  const row = {url: URL_A, stage: 'Applying', status: 'applied'};
  store.writes.changed(row, {stage: 'Kit ready'});
  assert.equal(row.stage, 'Kit ready');
  assert.equal(store.painted.length, 0);
});

test('writes close together share one read again (a read is a Python run)', async () => {
  const store = fakeStore('Saved');
  const done = store.writes.changed();
  for (let i = 0; i < 4; i += 1) store.writes.changed();   // four Dismisses while the first read runs
  store.answer(0, 'Saved');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.reads.length, 2, 'one read for the first write, one more for the rest');
  store.answer(1, 'Dismissed');
  await done;
  assert.deepEqual(store.painted.map(fresh => fresh.jobs[0].stage), ['Dismissed']);
});

test('a failed read paints nothing and lets the next write read again', async () => {
  const store = fakeStore('Saved');
  const done = store.writes.changed();
  store.reads[0].resolve(Promise.reject(new Error('Notion unreachable')));
  await done;
  assert.equal(store.painted.length, 0);
  store.writes.changed();
  assert.equal(store.reads.length, 2);
});

// The class. Every IPC whose main handler writes a job's stage (an engine stage write), read from main's own code: a new one fails here until it
// is listed, and then until the window answers it with jobsChanged.
const ENGINE_STAGE_WRITE = /pipeline\.(setStatus|unapply|notSubmitted|markOutcome)\(/;
const STAGE_WRITES = ['setStatus', 'setStage', 'unapplyJob', 'notSubmitted', 'markOutcome', 'sessionCancel', 'sessionSkip', 'sessionFinish'];
const LIB = fs.readdirSync(new URL('../lib/', import.meta.url)).filter(name => name.endsWith('.js')).map(name => `lib/${name}`);
test('every IPC handler that writes a job\'s stage is in the list the window is checked against', () => {
  const found = new Set();
  for (const file of [...LIB, 'main.js']) {
    const blocks = read(file).split(/\.handle\('/).slice(1);
    for (const block of blocks) if (ENGINE_STAGE_WRITE.test(block.split(/\n {2}\}\)\);|\n\s*ipcMain\.handle|\n\s*checkedSessions\.handle/)[0])) found.add(block.match(/^(\w+)'/)[1]);
  }
  assert.deepEqual([...found].sort(), [...STAGE_WRITES].sort());
});

const RENDERER = ['pages', '.'].flatMap(dir => fs.readdirSync(new URL(`../renderer/${dir}/`, import.meta.url))
  .filter(name => name.endsWith('.js')).map(name => `renderer/${dir === '.' ? '' : `${dir}/`}${name}`));
test('the window answers every stage write with jobsChanged, within the same handler', () => {
  let calls = 0;
  for (const file of RENDERER) {
    const source = read(file);
    // A board drop asks by name (window.pilot[move.call]: setStatus or setStage, renderer/jobs-board-rules.js dropFor).
    for (const match of source.matchAll(new RegExp(`window\\.pilot(?:\\.(${STAGE_WRITES.join('|')})|\\[(move\\.call)\\])\\(`, 'g'))) {
      calls += 1;
      const after = source.slice(match.index, match.index + 700);
      assert.match(after, /jobsChanged\(/, `${file}: window.pilot.${match[1] || match[2]}( is not followed by jobsChanged(`);
    }
  }
  assert.ok(calls >= 10, `positive control: the stage writes were found (${calls})`);
});

test('no page edits a job\'s stage or status in memory itself: only job-writes.js patches the row it was given', () => {
  for (const file of RENDERER.filter(name => name !== 'renderer/job-writes.js')) {
    assert.doesNotMatch(read(file), /\bjob\.(stage|status)\s*=(?!=)/, file);
  }
});

test('the session actions read the list again after Cancel, Skip and Close', () => {
  const actions = read('renderer/pages/session-actions.js');
  for (const name of ['removeSession', 'cancelSession', 'skipSession']) {
    const body = actions.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`))[0];
    assert.match(body, /jobsChanged\(/, name);
  }
});

// Main's side: a job-list read asked after a stage write must not join one that began before it (lib/shared-read.js).
test('every engine stage write closes the join of running reads, whoever asked for it', () => {
  const chunks = read('lib/pipeline-commands.js').split(/\n(?=export )/).filter(chunk => chunk.startsWith('export '));
  const writers = chunks.filter(chunk => /'src\.desktop', '(status|unapply|not-submitted|delete)'|'src\.notion\.ledger', 'event'/.test(chunk));
  assert.deepEqual(writers.map(chunk => chunk.match(/^export (?:async function|const) (\w+)/)[1]).sort(), ['deleteJob', 'markOutcome', 'notSubmitted', 'setStatus', 'unapply']);
  for (const chunk of writers) assert.match(chunk, /^export const \w+ = afterWrite\(async /, chunk.split('\n')[0]);
  assert.match(read('lib/apply.js'), /'--mark-applying'[^\n]*\)\.then\(readsChanged\)/, 'Apply moves the job to Applying: the same');
});
