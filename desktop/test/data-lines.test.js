// The engine's JSON answers ({"ok": true, "name": "Indeed", "jobs": 98, …}) never reach a person: not a task's step, log or the window's live log
// (7 Oct 2026: the Find employers in Chrome banner showed them). Words lines still do.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

test('JSON object lines are data; words and a brace in a sentence are not', () => {
  assert.ok(pipeline.isDataLine('{"ok": true, "name": "Indeed", "jobs": 98, "added": 18, "kind": "portal"}'));
  assert.ok(!pipeline.isDataLine('Visit: read 18 jobs on Indeed (indeed.com) from a page you opened; 18 new in this visit, 98 in all'));
  assert.ok(!pipeline.isDataLine('{not json at all}'));
});

test("a task's log and step leave the JSON out", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-data-'));
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  let seen = null;
  await pipeline.work(storage, 'visits', line => pipeline.keep(line), async tee => {
    tee('Visit: read 18 jobs on Indeed (indeed.com) from a page you opened; 18 new in this visit, 98 in all');
    tee('{"ok": true, "name": "Indeed", "jobs": 98, "added": 18, "kind": "portal"}');
    pipeline.keep('{"ok": true, "recipe": null}');
    seen = {log: [...pipeline.running().log], step: pipeline.running().step};
    return true;
  });
  assert.deepEqual(seen.log, ['Visit: read 18 jobs on Indeed (indeed.com) from a page you opened; 18 new in this visit, 98 in all']);
  assert.match(seen.step, /^Visit: read 18 jobs/);
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /const log = line => \{ if \(pipeline\.isDataLine\(line\)\) return;/, 'the window feed leaves it out too');
});
