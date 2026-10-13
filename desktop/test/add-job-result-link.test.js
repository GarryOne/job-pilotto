// "Add a job" and "Applied elsewhere" end with an "Open job" link to the job's drawer (owner, 13 Oct 2026): every add dialog uses linkToJob.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source = readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');

test('each add dialog that gets a result with a job ends in linkToJob, and the helper opens the drawer', () => {
  const dialogs = [...readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8').matchAll(/<dialog id="(import|applied)-dialog"/g)].map(m => m[1]);
  assert.deepEqual(dialogs.sort(), ['applied', 'import']);
  for (const name of dialogs) assert.match(source, new RegExp(`linkToJob\\('${name}-dialog', '${name}-message', result\\)`), `${name} dialog links its result`);
  assert.match(source, /openJobPanel\(job\)/);
});
