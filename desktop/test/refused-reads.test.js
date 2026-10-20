// "Read refused sites in my browser" (owner, 19 Oct 2026): ON by default (opt-out, 20 Oct 2026); turned off, the engine is never asked; on, the engine's queue goes to the extension, each page it
// fetched goes to the engine, and the pass is one Recent activity task with a line per site. A bot check or refusal in Chrome is a stop line, never "done".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {siteTest} from './site-private.js';
import {queue, outcome, done, settingOn, passRunning} from '../lib/refused-reads.js';
import * as now from '../lib/refused-now.js';

const storageWith = settings => { const kept = {...settings}; return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), kept}; };
const SITES = [{url: 'https://jobs.coop.ch', name: 'Coop', kind: 'employer'}, {url: 'https://www.monsterboard.nl/v?q=a', name: 'Monsterboard', kind: 'board'}];

function fakes() {
  const calls = [], lines = [];
  const run = async (_storage, args) => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[1] === 'refused-queue') return {stdout: JSON.stringify({ok: true, sites: SITES})};
    if (args[1] === 'refused-outcome') {
      const url = process.env.__LAST_URL;
      return {stdout: JSON.stringify(url.includes('coop') ? {ok: true, state: 'read', name: 'Coop', jobs: 4, fits: 2} : {ok: true, state: 'stopped', why: 'HTTP 429', name: 'Monsterboard'})};
    }
    return {stdout: ''};
  };
  let finished;
  const work = (_s, kind, _log, fn) => { calls.push(`work ${kind}`); return finished = fn(line => lines.push(line)).then(ok => { calls.push(`task ended ${ok}`); }); };
  return {calls, lines, run, work, ended: () => finished};
}

test('on by default; turned off, the queue is empty and the engine is never asked', async () => {
  const f = fakes(), off = () => storageWith({readRefusedSites: false});
  assert.equal(settingOn(storageWith({})), true);
  assert.equal(settingOn(off()), false);
  const answer = await queue(off(), {run: f.run, work: f.work});
  assert.deepEqual([answer.on, answer.sites, f.calls], [false, [], []]);
  assert.equal((await outcome(off(), {url: 'https://jobs.coop.ch', status: 200, html: 'x'}, {run: f.run})).ok, false, 'an outcome sent while turned off is dropped');
  assert.deepEqual(f.calls, []);
});

test('on: one pass is one task with a line per site, and the engine keeps what each page brought', async () => {
  const f = fakes(), storage = storageWith({readRefusedSites: true});
  const answer = await queue(storage, {run: f.run, work: f.work, scoreArgs: () => ['src.desktop', 'score']});
  assert.deepEqual(answer.sites.map(site => site.name), ['Coop', 'Monsterboard']);
  assert.ok(passRunning());
  assert.equal((await queue(storage, {run: f.run, work: f.work})).sites.length, 0, 'a pass is already running: nothing handed out twice');
  for (const [url, status] of [['https://jobs.coop.ch', 200], ['https://www.monsterboard.nl/v?q=a', 429]]) {
    process.env.__LAST_URL = url;
    await outcome(storage, {url, status, html: status === 200 ? '<html></html>' : '', title: 't'}, {run: f.run});
  }
  await f.ended();
  assert.ok(!passRunning());
  assert.deepEqual(f.lines.filter(line => line.startsWith('  ▸')), ['  ▸ next · Coop · https://jobs.coop.ch', '  ▸ next · Monsterboard · https://www.monsterboard.nl/v?q=a',
    '  ▸ done · Coop · 4 jobs read', '  ▸ stopped · Monsterboard · HTTP 429']);
  assert.ok(f.lines.some(line => /^Read 1 of 2 sites/.test(line)));
  assert.equal(f.calls.filter(call => call === 'work visits').length, 1);
});

test('without the extension permission nothing is handed out and Settings is told to ask for it', async () => {
  const f = fakes(), storage = storageWith({readRefusedSites: true});
  const answer = await queue(storage, {allowed: false, run: f.run, work: f.work});
  assert.deepEqual([answer.on, answer.sites, storage.kept.refusedNeedsAllow, f.calls], [true, [], true, []]);
  await queue(storage, {allowed: true, run: async () => ({stdout: JSON.stringify({ok: true, sites: []})}), work: f.work});
  assert.equal(storage.kept.refusedNeedsAllow, false);
});

test('the extension ending a pass early closes the task with what it has', async () => {
  const f = fakes(), storage = storageWith({readRefusedSites: true});
  await queue(storage, {run: f.run, work: f.work});
  await done();
  await f.ended();
  assert.ok(!passRunning());
});

test('Settings has the switch, on by default, and Privacy and the rule name the feature', async () => {
  const fs = await import('node:fs'), root = new URL('../../', import.meta.url);
  const {readRefusedOn} = await import('../renderer/pages/refused-read-setting.js');
  assert.equal(readRefusedOn({}), true);
  assert.equal(readRefusedOn({readRefusedSites: false}), false);
  assert.equal(readRefusedOn({readRefusedSites: true}), true);
  assert.match(fs.readFileSync(new URL('desktop/renderer/index.html', root), 'utf8'), /id="refused-read-tick"/);
  assert.match(fs.readFileSync(new URL('CLAUDE.md', root), 'utf8'), /Read refused sites in my browser/);
});

siteTest('Privacy names the feature', async () => {   // the page lives in job-pilotto-site
  const fs = await import('node:fs');
  assert.match(fs.readFileSync(new URL('../../site/public/privacy.html', import.meta.url), 'utf8'), /Read refused sites in my browser/);
});

test('Read now: a job opened from a site, or Check for new jobs, makes the engine ask for those sites at once', async () => {
  const f = fakes(), seen = [];
  const run = async (storage, args) => { seen.push(args); return f.run(storage, args); };
  now.take();
  now.readNow('https://www.jobs.coop.ch/offres/1');
  assert.equal(now.pending(), true);
  await queue(storageWith({readRefusedSites: true}), {run, work: f.work, scoreArgs: () => ['src.desktop', 'score']});
  assert.deepEqual(seen[0], ['src.desktop', 'refused-queue', '--now', 'jobs.coop.ch']);
  assert.equal(now.pending(), false, 'taken once, not asked again');
  await outcome(storageWith({readRefusedSites: true}), {url: 'https://jobs.coop.ch', status: 200, html: 'x'}, {run: f.run}).catch(() => {});
  await done();
  now.readAllNow();
  await queue(storageWith({readRefusedSites: true}), {run, work: f.work, scoreArgs: () => ['src.desktop', 'score']});
  assert.deepEqual(seen.at(-1), ['src.desktop', 'refused-queue', '--all']);
  await done();
});
