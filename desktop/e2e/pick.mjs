// The fixer's first step (ui-fix.yml, four times a day): the most critical open finding that is ready for a fix, from the issues the producer (ui-findings.yml) keeps filing.
//   node pick.mjs --out .heal      (needs `gh` and GH_TOKEN)
// Writes <out>/candidate.json + <out>/prompt.md and sets the step output `candidate` (the issue number, or "none").
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chooseCandidate, chooseVerdictCandidate, writeCandidate} from './triage.mjs';

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const outDir = (args.indexOf('--out') >= 0 && args[args.indexOf('--out') + 1]) || '.heal';
  fs.mkdirSync(outDir, {recursive: true});
  let candidate = chooseCandidate();
  // Nothing to fix: judge a one-off finding instead, without editing anything (only when the repo variable JOB_PILOTTO_FIXER_VERDICTS is "on": it spends AI credit).
  if (!candidate && process.env.VERDICTS === 'on') candidate = chooseVerdictCandidate();
  const line = candidate ? (candidate.mode === 'verdict' ? `Nothing to fix; judging a one-off finding (verdict only): #${candidate.number} ${candidate.title}` : `Most critical finding ready to fix: #${candidate.number} ${candidate.title}`) : 'Nothing is ready to fix (a finding needs two sightings this week, or a person\'s confirmed label).';
  if (candidate) writeCandidate(candidate, outDir);
  console.log(`## UI fixer\\n${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## UI fixer\\n${line}\\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${candidate ? candidate.number : 'none'}\n`   /* a real newline: a literal \\n made the output "none\\n" and every 'none' guard passed (a quiet run failed, 3 Oct 2026) */);
}
