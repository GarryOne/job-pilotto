// The fixer's first step (ui-fix.yml, four times a day): the most critical open finding that is ready for a fix, from the issues the producer (ui-findings.yml) keeps filing.
//   node pick.mjs --out .heal      (needs `gh` and GH_TOKEN)
// Writes <out>/candidate.json + <out>/prompt.md and sets the step output `candidate` (the issue number, or "none").
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chooseCandidate, chooseVerdictCandidate, fixerSummary, writeCandidate, chooseVerdictCandidates} from './triage.mjs';

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const outDir = (args.indexOf('--out') >= 0 && args[args.indexOf('--out') + 1]) || '.heal';
  fs.mkdirSync(outDir, {recursive: true});
  // ui-verdict.yml: the one-off findings to judge in parallel (--verdict-list N), or the files for one of them (--issue N).
  const at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : ''; };
  if (args.includes('--verdict-list')) {
    const list = chooseVerdictCandidates({max: Number(at('--verdict-list')) || 5}).map(issue => ({issue: issue.number}));
    console.log(`To judge: ${list.map(item => `#${item.issue}`).join(', ') || 'nothing'}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({include: list})}\ncount=${list.length}\n`);
    process.exit(0);
  }
  if (args.includes('--issue')) {
    const issue = JSON.parse(execFileSync('gh', ['issue', 'view', at('--issue'), '--json', 'number,title,body,labels,comments,state'], {encoding: 'utf8'}));
    writeCandidate({...issue, mode: 'verdict'}, outDir);
    console.log(`Judging #${issue.number} ${issue.title}`);
    process.exit(0);
  }
  let candidate = chooseCandidate();
  // Nothing to fix: judge a one-off finding instead, without editing anything (only when the repo variable JOB_PILOTTO_FIXER_VERDICTS is "on": it spends AI credit).
  if (!candidate && process.env.VERDICTS === 'on') candidate = chooseVerdictCandidate();
  if (candidate) writeCandidate(candidate, outDir);
  const summary = fixerSummary({candidate});
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${candidate ? candidate.number : 'none'}\n`   /* a real newline: a literal \\n made the output "none\\n" and every 'none' guard passed (a quiet run failed, 3 Oct 2026) */);
}
