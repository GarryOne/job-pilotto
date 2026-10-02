// The board benchmarks shown on an applied job (lib/benchmarks.js): only known boards with enough applications, and one plain line per job.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean, lines, save} from '../lib/benchmarks.js';
import {boardName} from '../lib/control-events.js';

const memory = () => { const files = {}; return {writeText: (name, text) => { files[name] = text; }, readText: name => files[name] || ''}; };

test('only known boards with 30+ applications and a believable share are kept', () => {
  assert.deepEqual(clean([{board: 'greenhouse', n: 80, heard: 0.38, days: '4-7'}, {board: 'h:abc1234567', n: 99, heard: 0.5, days: ''}, {board: 'lever', n: 10, heard: 0.5, days: ''},
    {board: 'ashby', n: 40, heard: 3, days: ''}, {board: 'workable', n: 40, heard: 0.2, days: 'soon'}]), [{board: 'greenhouse', n: 80, heard: 0.38, days: '4-7'}]);
  assert.deepEqual(clean('nope'), []);
});

test('a job on a benchmarked board gets one line; others get none', () => {
  const storage = memory();
  save(storage, [{board: 'greenhouse', n: 80, heard: 0.38, days: '4-7'}]);
  const out = lines(storage, ['https://boards.greenhouse.io/acme/jobs/1', 'https://jobs.lever.co/x/2', 'nonsense'], boardName);
  assert.deepEqual(Object.keys(out), ['https://boards.greenhouse.io/acme/jobs/1']);
  assert.match(out['https://boards.greenhouse.io/acme/jobs/1'], /^Typical on Greenhouse: 38% hear back, usually within 4–7 days \(80 applications\)$/);
  assert.deepEqual(lines(memory(), ['https://boards.greenhouse.io/a/1'], boardName), {});   // nothing fetched yet: no line
});
