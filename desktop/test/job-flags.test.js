// The job list's rows carry `tailored` and `letter` for every caller (pipeline.jobs): a finished job (kit + tailored CV + letter PDF) is found by Send tonight, and "Tailor top matches" skips tailored ones.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import {markFinished} from '../lib/job-flags.js';
import {complete} from '../lib/ready.js';
import * as cvlib from '../lib/cv.js';
import * as jobLetter from '../lib/job-letter.js';

const folder = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-flags-')); return {settings: () => ({lastSearchAt: 'x'}), path: name => path.join(dir, name), dir}; };

test('a row has tailored and letter from the files on this Mac, and complete() follows them', () => {
  const storage = folder();
  fs.mkdirSync(jobLetter.dir(storage), {recursive: true});
  const result = {jobs: [{code: 'abc1', kit: true}, {code: 'abc2', kit: true}, {kit: true}]};
  markFinished(storage, result);
  assert.deepEqual(result.jobs.map(job => [job.tailored, job.letter]), [[false, false], [false, false], [false, false]]);
  fs.writeFileSync(jobLetter.pdfPath(storage, 'abc1'), '%PDF');
  fs.mkdirSync(path.dirname(cvlib.dir ? path.join(cvlib.dir(storage), 'x') : storage.path('cv/x')), {recursive: true});
  markFinished(storage, result);
  assert.equal(result.jobs[0].letter, true);
  assert.equal(complete(result.jobs[0]), false);   // the CV is still missing
});

test('every caller of pipeline.jobs gets the flags, not only the Jobs page', async () => {
  const storage = folder();
  fs.mkdirSync(jobLetter.dir(storage), {recursive: true});
  fs.writeFileSync(jobLetter.pdfPath(storage, 'abc1'), '%PDF');
  const run = async () => ({code: 0, stdout: `${JSON.stringify({ok: true, jobs: [{code: 'abc1', kit: true}]})}\n`});
  const result = await pipeline.jobs(storage, 77, run);
  assert.equal(result.jobs[0].letter, true);
  assert.equal(result.jobs[0].tailored, false);
});
