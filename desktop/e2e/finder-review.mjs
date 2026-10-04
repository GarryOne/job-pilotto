// Writes the week's facts for the Finder's weekly self-review (finder-review.yml) to .finder-review/facts.md: node finder-review.mjs [out-dir]. Needs gh.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {weekFacts} from './lib/finder-review.mjs';

const out = process.argv[2] || '.finder-review';
const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '400', '--json', 'number,title,state,stateReason,labels,comments,createdAt,closedAt'],
  {encoding: 'utf8', maxBuffer: 50 * 1024 * 1024}));
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'facts.md'), weekFacts(issues));
console.log(`${path.join(out, 'facts.md')}: ${issues.length} loop issues read`);
