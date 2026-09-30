// Duplicate 📈 Application Events are tidied automatically (src/notion/ledger.py heal): no button, a start-up pass
// once per version of the rules, and every removal a line in logs/app.log.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as migrate from '../lib/migrate.js';
import * as pipeline from '../lib/pipeline.js';
import {logFile, logTo} from '../lib/log.js';
import {createStorage} from '../lib/storage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, '..', name), 'utf8');
const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const storage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('Settings has no "Tidy duplicate events" button or dialog, and no IPC for one', () => {
  for (const file of ['renderer/index.html', 'renderer/pages/settings.js', 'preload.cjs', 'main.js']) {
    assert.doesNotMatch(read(file), /tidy-open|tidy-dialog|tidyEvents/, file);
  }
});

test('the start-up tidy runs once per version of its rules, and never reports a "move"', async () => {
  const step = migrate.STEPS.find(s => s.name === 'duplicate events');
  assert.ok(step);
  const done = storage();
  done.saveSettings({eventsTidied: migrate.TIDY_RULES});
  assert.equal(await step.run(done), false);  // already tidied with these rules: nothing runs
});

test('a removal a job prints is a line in app.log', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-log-'));
  const before = logFile();
  logTo(folder);
  const line = 'Removed 1 duplicate event on Principal SRE at Huxley: Interview scheduled (date looked wrong)';
  const encoded = path.join(folder, 'line.b64');
  fs.writeFileSync(encoded, Buffer.from(`${line}\nsomething else\n`).toString('base64'));
  const seen = [];
  await pipeline.run(storage(), ['base64', '-d', encoded], text => seen.push(text));  // a job printing that line
  if (before) logTo(path.dirname(before));
  assert.ok(seen.includes(line));
  const logged = fs.readFileSync(path.join(folder, 'app.log'), 'utf8');
  assert.match(logged, /\[tidy\] Removed 1 duplicate event on Principal SRE at Huxley: Interview scheduled \(date looked wrong\)/);
  assert.doesNotMatch(logged, /something else/);
});
