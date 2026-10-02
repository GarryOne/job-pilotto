// A run the watchdog stops (a silent AI) is killed, and a killed Python cannot close its own Notion row: it stayed "Running" and the app showed the task as running
// for 3 hours (2 Oct 2026, found by the activity e2e suite). The app closes the row of a run it stopped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import * as runHistory from '../lib/run-history.js';

const PAGE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const URL = `https://app.notion.com/p/2026-10-02-17-09-Jobs-check-${PAGE}`;
const json = body => ({ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Map()});

test('closeStopped fails a row still Running, and leaves a row that was closed alone', async () => {
  const calls = [];
  const rows = {running: 'Running', done: 'OK'};
  for (const [name, status] of Object.entries(rows)) {
    calls.length = 0;
    const fetcher = async (url, init) => { calls.push([init.method, String(url).replace('https://api.notion.com/v1/', ''), init.body]); return json({id: PAGE, properties: {Status: {select: {name: status}}}}); };
    const storage = {secret: () => 'token'};
    const closed = await runHistory.closeStopped(storage, URL, 'Stopped by Job Pilotto: no output for 1 min', {fetcher});
    assert.equal(closed, status === 'Running', name);
    const patch = calls.find(call => call[0] === 'PATCH');
    if (status === 'Running') {
      assert.match(patch[1], /^pages\/[0-9a-f-]+$/);
      assert.equal(patch[1].replace(/\D*pages\//, '').replace(/-/g, ''), PAGE);
      const body = JSON.parse(patch[2]);
      assert.equal(body.properties.Status.select.name, 'Failed');
      assert.match(body.properties.Summary.rich_text[0].text.content, /Stopped by Job Pilotto/);
    } else assert.equal(patch, undefined);
  }
});

test('a run stopped by the watchdog has its Notion row closed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-stopped-'));
  fs.writeFileSync(path.join(dir, 'quietrun.py'), `print('Cronjob run logged: ${URL}', flush=True)\nimport time\ntime.sleep(60)\n`);
  const storage = {settings: () => ({}), secret: name => (name === 'NOTION_TOKEN' ? 'token' : ''), saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)};
  const saved = {...pipeline.LIMITS}, realFetch = globalThis.fetch, calls = [];
  Object.assign(pipeline.LIMITS, {idleMs: 600, totalMs: 60000, checkMs: 100, killAfterMs: 500, watchAll: true});
  globalThis.fetch = async (url, init) => { calls.push([init?.method, String(url), init?.body]); return json({id: PAGE, properties: {Status: {select: {name: 'Running'}}}}); };
  try {
    const {timedOut} = await pipeline.run(storage, ['quietrun'], () => {}, {PYTHONPATH: dir});
    assert.match(timedOut, /no output for/);
  } finally { Object.assign(pipeline.LIMITS, saved); globalThis.fetch = realFetch; }
  const patch = calls.find(call => call[0] === 'PATCH');
  assert.ok(patch, `the row was not closed (calls: ${calls.map(call => call[0]).join(', ') || 'none'})`);
  assert.equal(JSON.parse(patch[2]).properties.Status.select.name, 'Failed');
});
