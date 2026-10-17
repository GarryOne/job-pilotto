// Which harness test files run where (test-sets.json): the PR set or the daily set; prints one set's files for the CI workflows to hand to node --test.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export function testSets() {
  const {pr, daily} = JSON.parse(readFileSync(`${here}test-sets.json`, 'utf8'));
  return {pr, daily};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sets = testSets();
  const which = process.argv[2];
  if (!sets[which] && which !== 'all') { console.error('usage: node test-sets.mjs pr|daily|all'); process.exit(2); }
  const files = which === 'all' ? [...sets.pr, ...sets.daily] : sets[which];
  console.log(files.map((f) => `test/${f}`).join(' '));
}
