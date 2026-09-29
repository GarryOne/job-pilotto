// The Notion request log (lib/request-log.js): one line per request, tagged with the part of the app that asked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {caller, setFile, write} from '../lib/request-log.js';

test('each request is one tab-separated line: time, who, method, route (no query), status, duration, try', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reqlog-')), 'notion-requests.log');
  setFile(file);
  write({method: 'GET', route: 'pages/abc?filter=x', status: 429, ms: 183, attempt: 0, who: 'app:extension'});
  // The line is appended asynchronously: wait for it (up to 2 s; a slow Windows runner once needed more than 50 ms).
  for (let waited = 0; waited < 2000 && !(fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim()); waited += 20) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const [line] = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.deepEqual(line.split('\t').slice(1), ['app:extension', 'GET', 'pages/abc', '429', '183ms', 'try 1']);
  setFile(null);
});

test('the caller is the first app module on the stack that is not the Notion client', () => {
  const stack = 'Error\n    at write (/x/desktop/lib/request-log.js:1:1)\n    at call (/x/desktop/lib/notion.js:9:9)\n    at learn (/x/desktop/lib/knowledge.js:3:3)';
  assert.equal(caller(stack), 'app:knowledge');
});
