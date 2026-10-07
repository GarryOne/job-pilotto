// Every suite that runs the engine's Python itself does it as the app does (lib/python.mjs): UTF-8 on Windows too (7 Oct 2026: the pool suite stopped on
// Windows at "'charmap' codec can't decode byte 0x8f", and visitread and mailreading spawned it the same way).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {pythonEnv} from '../lib/python.mjs';

test('the engine runs with UTF-8 mode on, and a suite\'s own variables win', () => {
  assert.equal(pythonEnv().PYTHONUTF8, '1');
  assert.equal(pythonEnv({JOB_PILOTTO_FOLLOW_APP: '0'}).JOB_PILOTTO_FOLLOW_APP, '0');
});

test('no suite keeps its own python() or spawns it without pythonEnv', () => {
  const dir = new URL('../suites/', import.meta.url);
  const spawning = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.mjs'))) {
    const source = fs.readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(source, /const python = \(\)/, `${file} defines its own python(): import it from lib/python.mjs`);
    // Each call's options, up to the end of the line: they must carry pythonEnv(...).
    for (const line of source.split('\n').filter(text => /execFile(Sync)?\(python\(\)/.test(text))) {
      spawning.push(file);
      const at = source.indexOf(line), call = source.slice(at, at + 600);
      assert.match(call, /env: pythonEnv\(/, `${file} runs python() without env: pythonEnv(...): ${line.trim().slice(0, 100)}`);
    }
  }
  assert.ok(new Set(spawning).size >= 3, `the check found the suites that run the engine (pool, mailreading, visitread): ${[...new Set(spawning)].join(', ')}`);
});
