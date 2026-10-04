// Opens this week's verdict audit (lib/verdict-audit.mjs) and closes last week's with its score. No AI. Run by finder-review.yml.
import {execFileSync} from 'node:child_process';
import {AUDIT_LABEL, auditBody, auditScore, sampleVerdicts} from './lib/verdict-audit.mjs';
import {REGISTER_LABEL, registerEntries} from './lib/prejudge.mjs';

const gh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 50 * 1024 * 1024});
const issues = JSON.parse(gh(['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '300', '--json', 'number,title,comments']));
const register = registerEntries(JSON.parse(gh(['issue', 'list', '--label', REGISTER_LABEL, '--state', 'open', '--limit', '1', '--json', 'body']))[0]?.body);
const open = JSON.parse(gh(['issue', 'list', '--label', AUDIT_LABEL, '--state', 'open', '--limit', '5', '--json', 'number,body']));
let last = null;
for (const issue of open) {
  last = auditScore(issue.body);
  gh(['issue', 'close', String(issue.number), '--comment', `Closed by the next audit: ${last.right} of ${last.right + last.wrong} ticked verdicts were right.`]);
}
const items = sampleVerdicts({issues, register});
if (!items.length) { console.log('No verdicts in the last 7 days: no audit.'); process.exit(0); }
gh(['label', 'create', AUDIT_LABEL, '--force', '--color', '1D76DB', '--description', 'The weekly check of the verdict pass: tick right or wrong']);
const url = gh(['issue', 'create', '--label', AUDIT_LABEL, '--title', `🎯 Verdict audit: were these ${items.length} verdicts right?`, '--body', auditBody(items, last)]).trim();
console.log(`Audit opened: ${url}${last ? ` (last: ${last.right}/${last.right + last.wrong} right)` : ''}`);
