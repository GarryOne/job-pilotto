// Files tonight's findings as GitHub issues (one per problem, found again = a comment) and picks the one ready to be fixed.
//   node triage.mjs --artifacts <dir> --run-url <url> --out <dir>      (needs `gh` and GH_TOKEN with issues: write)
// Writes <out>/candidate.json + <out>/prompt.md when a finding is ready, and sets the step output `candidate` (the issue number, or "none").
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {LABEL, issueBody, issueTitle, labelFor, normalize, pickCandidate} from './lib/triage.mjs';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const realGh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});

// -> {filed, again, candidate}. `gh` is injected so the rules can be tested without GitHub.
export function triage({artifacts, runUrl, gh = realGh}) {
  const findings = normalize({ui: read(path.join(artifacts, 'ui-findings.json')) || [], ai: (read(path.join(artifacts, 'ai-findings.json')) || {}).findings || []});
  const list = () => JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,state,labels,body,comments,title']));
  let issues = list();
  const out = {filed: [], again: [], candidate: null};
  gh(['label', 'create', LABEL, '--force', '--color', 'C2E0C6', '--description', 'Found by the nightly UI loop']);
  for (const finding of findings) {
    const label = labelFor(finding.id);
    const existing = issues.find(issue => issue.labels.some(item => (item.name || item) === label));
    if (!existing) {
      gh(['label', 'create', label, '--force', '--color', 'EDEDED']);
      gh(['issue', 'create', '--title', issueTitle(finding), '--body', issueBody(finding, runUrl), '--label', `${LABEL},${label}`]);
      out.filed.push(finding.id);
    } else if (existing.state === 'OPEN' && !(existing.comments || []).some(comment => (comment.body || '').includes(runUrl))) {
      gh(['issue', 'comment', String(existing.number), '--body', `Seen again in run ${runUrl}`]);
      out.again.push(finding.id);
    }
  }
  issues = list();
  const branches = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])).map(pr => pr.headRefName);
  out.candidate = pickCandidate(issues, {openBranches: branches});
  return {...out, findings};
}

export const promptFor = (issue, base) => `${base}\n\n---\nTHE FINDING (issue #${issue.number}):\n${issue.title}\n\n${issue.body}\n`;

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ''; };
  const outDir = option('out') || '.heal';
  fs.mkdirSync(outDir, {recursive: true});
  const result = triage({artifacts: option('artifacts'), runUrl: option('run-url')});
  const lines = [`## Nightly UI loop`, `${result.findings.length} finding(s) tonight: ${result.filed.length} new, ${result.again.length} seen again.`];
  const candidate = result.candidate;
  if (candidate) {
    const base = fs.readFileSync(new URL('./ui-fix-prompt.md', import.meta.url), 'utf8');
    fs.writeFileSync(path.join(outDir, 'candidate.json'), JSON.stringify({number: candidate.number, title: candidate.title, id: candidate.labels.map(l => l.name).find(n => n.startsWith('fp:')).slice(3)}));
    fs.writeFileSync(path.join(outDir, 'prompt.md'), promptFor(candidate, base));
    lines.push(`Ready to fix: #${candidate.number} ${candidate.title}`);
  } else lines.push('Nothing is ready to fix (a finding needs to be seen in two runs).');
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${candidate ? candidate.number : 'none'}\n`);
}
