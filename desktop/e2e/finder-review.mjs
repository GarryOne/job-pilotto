// Writes the week's facts for the Finder's weekly self-review (finder-review.yml) to .finder-review/facts.md: node finder-review.mjs [out-dir]. Needs gh.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {weekFacts} from './lib/finder-review.mjs';
import {asIssues, REGISTER_LIST, registerEntries} from './lib/prejudge.mjs';

const out = process.argv[2] || '.finder-review';
const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '400', '--json', 'number,title,state,stateReason,labels,comments,createdAt,closedAt'],
  {encoding: 'utf8', maxBuffer: 50 * 1024 * 1024}));
// What the verdict pass judged noise BEFORE filing is the week's false positives too: the lessons this review learns from (lib/prejudge.mjs asIssues).
let judged = [];
try { judged = asIssues(registerEntries(JSON.parse(execFileSync('gh', REGISTER_LIST, {encoding: 'utf8'}))[0]?.body)); } catch { judged = []; }
fs.mkdirSync(out, {recursive: true});
const lessons = fs.existsSync(path.join(out, 'lessons.md')) ? fs.readFileSync(path.join(out, 'lessons.md'), 'utf8') : '';   // finder-review.yml runs reversals.mjs first
fs.writeFileSync(path.join(out, 'facts.md'), weekFacts([...issues, ...judged]) + (lessons ? `\n## Verdicts a person corrected (the strongest lessons: make the rules decide these the way the person did)\n${lessons}` : ''));
console.log(`${path.join(out, 'facts.md')}: ${issues.length} loop issues read`);
