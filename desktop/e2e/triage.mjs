// Files tonight's findings as GitHub issues (one per problem, found again = a comment) and picks the one ready to be fixed.
//   node triage.mjs --artifacts <dir> --run-url <url> --out <dir>      (needs `gh` and GH_TOKEN with issues: write)
// Writes <out>/candidate.json + <out>/prompt.md when a finding is ready, and sets the step output `candidate` (the issue number, or "none").
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {LABEL, NOT_SEEN, issueBody, issueTitle, labelFor, labelsFor, matchExisting, normalize, notSeenComment, suppressedBy, pickCandidate, screenshotOf, seenAgainComment} from './lib/triage.mjs';
import {publishFiles} from './lib/evidence.mjs';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// The findings files below a folder, whatever the suite folders are called.
export function filesNamed(folder) {
  const out = {'ui-findings.json': [], 'ai-findings.json': [], 'suite-failures.json': []};
  const walk = dir => { for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}) : []) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (out[entry.name]) out[entry.name].push(full);
  } };
  walk(folder);
  return out;
}
const realGh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});

const suiteOf = dir => path.basename(dir || '').replace(/^e2e-artifacts-/, '');
const tail = (file, lines = 25) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-lines).join('\n').slice(-3500); } catch { return ''; } };
const slug = step => `failed-${String(step).replace(/\W+/g, '-').slice(0, 60)}`;   // the runner's name for a failed step's screenshot (lib/runner.mjs)
const views = dir => { try { return fs.readdirSync(dir).map(name => /^ui-(.+)\.png$/.exec(name)?.[1]).filter(Boolean); } catch { return []; } };

// The files that show a finding: the page's screenshot, or for a failed step its failure screenshot.
function evidenceFile(finding) {
  if (!finding.dir) return '';
  const choices = finding.source === 'suite-failure' ? [`${slug(finding.stepName || finding.title.replace(/^step failed: /, ''))}.png`, 'last.png'] : [`ui-${finding.view}.png`];
  return choices.map(name => path.join(finding.dir, name)).find(file => fs.existsSync(file)) || '';
}
const urlOf = (urls, to) => (to && urls[to]) || '';

// -> {filed, again, gone, candidate}. `gh` and `publish` (the screenshot upload: files -> {to: url}) are injected so the rules can be tested without GitHub.
export function triage({artifacts, runUrl, gh = realGh, publish = publishFiles, repo = process.env.REPO || process.env.GITHUB_REPOSITORY || ''}) {
  const found = filesNamed(artifacts);   // every suite's folder (e2e-artifacts/e2e-artifacts-<suite>/…), or one flat folder
  const withDir = (file, items) => items.map(item => ({...item, _dir: path.dirname(file)}));
  const findings = normalize({ui: found['ui-findings.json'].flatMap(file => withDir(file, read(file) || [])), ai: found['ai-findings.json'].flatMap(file => withDir(file, (read(file) || {}).findings || [])),
    suite: found['suite-failures.json'].flatMap(file => withDir(file, read(file) || []))});
  const list = () => JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,state,labels,body,comments,title,createdAt']));
  let issues = list();
  const out = {filed: [], again: [], gone: [], candidate: null};
  const runId = String(runUrl).split('/').pop() || 'run';

  // 1. decide what each finding is: new, a repeat of an open issue (even when the AI worded it differently), or already told in this run.
  const plan = findings.map(finding => ({finding, existing: matchExisting(finding, issues)})).filter(({finding, existing}) => existing || !suppressedBy(finding, issues));   // a closed false positive stays closed
  const matched = new Set(plan.filter(item => item.existing).map(item => item.existing.number));
  const needsPicture = plan.filter(({existing}) => !existing || (existing.state === 'OPEN' && !(existing.comments || []).some(comment => (comment.body || '').includes(runUrl))));

  // 2. a finding that was open, whose page was photographed and reviewed again in this run and did not come back: it is "not seen" (a fix, or a one-off).
  const reviewed = {ai: new Set(), layout: new Set()};
  for (const file of found['ai-findings.json']) for (const view of views(path.dirname(file))) reviewed.ai.add(view);
  for (const file of found['ui-findings.json']) for (const view of views(path.dirname(file))) reviewed.layout.add(view);
  const gone = issues.filter(issue => issue.state === 'OPEN' && !matched.has(issue.number) && !(issue.labels || []).some(item => (item.name || item) === NOT_SEEN)
    && !(issue.comments || []).some(comment => (comment.body || '').includes(runUrl))).map(issue => {
    const view = /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1] || '';
    const source = /found by (the AI screenshot review|the layout check)/.exec(issue.body || '')?.[1];
    const seen = source === 'the AI screenshot review' ? reviewed.ai : source === 'the layout check' ? reviewed.layout : new Set();
    const dir = found[source === 'the AI screenshot review' ? 'ai-findings.json' : 'ui-findings.json'].map(file => path.dirname(file)).find(folder => views(folder).includes(view));
    return seen.has(view) ? {issue, view, dir} : null;
  }).filter(Boolean);

  // 3. one upload of every picture that is needed (a failure to upload never stops the issues).
  const uploads = [];
  const target = (finding, name) => `ui-loop/${finding.id}/${runId}-${name}`;
  for (const {finding} of needsPicture) { const from = evidenceFile(finding); if (from) uploads.push({from, to: target(finding, path.basename(from))}); }
  for (const {issue, view, dir} of gone) { const from = dir && path.join(dir, `ui-${view}.png`); const id = /fp:(\S+)/.exec((issue.labels || []).map(item => item.name || item).join(' '))?.[1] || `issue-${issue.number}`;
    if (from && fs.existsSync(from)) uploads.push({from, to: `ui-loop/${id}/${runId}-${view}-clear.png`}); }
  let urls = {};
  if (uploads.length && repo) { try { urls = publish({repo, files: uploads, message: `Evidence of run ${runId}`}); } catch (error) { console.error(`screenshots not uploaded: ${error.message}`); } }

  gh(['label', 'create', LABEL, '--force', '--color', 'C2E0C6', '--description', 'Found by the nightly UI loop']);
  for (const {finding, existing} of plan) {
    const suite = suiteOf(finding.dir) || (finding.source === 'suite-failure' ? finding.view : '');
    const from = evidenceFile(finding), to = from ? target(finding, path.basename(from)) : '';
    const picture = urlOf(urls, to);
    if (!existing) {
      const facts = finding.dir ? read(path.join(finding.dir, `ui-${finding.view}.json`)) : null;
      const logs = finding.source === 'suite-failure' && finding.dir ? {'engine.log': tail(path.join(finding.dir, 'logs', 'engine.log')), 'app.log': tail(path.join(finding.dir, 'logs', 'app.log'))} : {};
      const codeFile = fs.existsSync(new URL(`../../renderer/pages/${finding.view}.js`, import.meta.url)) ? `desktop/renderer/pages/${finding.view}.js` : '';
      const evidence = {suite, [finding.source === 'suite-failure' ? 'failedScreenshot' : 'screenshot']: picture, facts, logs, codeFile};
      const labels = [LABEL, labelFor(finding.id), ...labelsFor(finding, suite)];
      for (const label of labels.slice(1)) gh(['label', 'create', label, '--force', '--color', label.startsWith('severity:high') ? 'D93F0B' : label.startsWith('severity:') ? 'FBCA04' : 'EDEDED']);
      gh(['issue', 'create', '--title', issueTitle(finding), '--body', issueBody(finding, runUrl, evidence), '--label', labels.join(',')]);
      out.filed.push(finding.id);
    } else if (existing.state === 'OPEN' && !(existing.comments || []).some(comment => (comment.body || '').includes(runUrl))) {
      gh(['issue', 'comment', String(existing.number), '--body', seenAgainComment(runUrl, picture)]);
      if ((existing.labels || []).some(item => (item.name || item) === NOT_SEEN)) gh(['issue', 'edit', String(existing.number), '--remove-label', NOT_SEEN]);
      out.again.push(finding.id);
    }
  }
  for (const {issue, view, dir} of gone) {
    const id = /fp:(\S+)/.exec((issue.labels || []).map(item => item.name || item).join(' '))?.[1] || `issue-${issue.number}`;
    const picture = urlOf(urls, `ui-loop/${id}/${runId}-${view}-clear.png`);
    gh(['label', 'create', NOT_SEEN, '--force', '--color', 'BFD4F2', '--description', 'The page was reviewed again and the finding did not come back']);
    gh(['issue', 'comment', String(issue.number), '--body', notSeenComment(runUrl, picture)]);
    gh(['issue', 'edit', String(issue.number), '--add-label', NOT_SEEN]);
    // The open fix pull request for it gets the same "after" picture.
    const branch = id ? `auto-fix/${id}` : '';
    const prs = branch ? JSON.parse(gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'])) : [];
    for (const pr of prs) gh(['pr', 'comment', String(pr.number), '--body', `${notSeenComment(runUrl, picture)}\n\nThis is the "after" for #${issue.number}.`]);
    out.gone.push(id);
  }
  issues = list();
  const branches = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])).map(pr => pr.headRefName);
  out.candidate = pickCandidate(issues, {openBranches: branches});
  return {...out, findings};
}

// The open issues of the loop and the open fix branches -> the most critical issue that is ready (or null). Used by the fixer (pick.mjs).
export function chooseCandidate({gh = realGh, now = Date.now()} = {}) {
  const issues = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '300', '--json', 'number,state,labels,body,comments,title,createdAt']));
  const branches = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])).map(pr => pr.headRefName);
  return pickCandidate(issues, {openBranches: branches, now});
}

// The files the fix step reads: which issue, its id, its "before" screenshot, and the prompt.
export function writeCandidate(candidate, outDir) {
  const base = fs.readFileSync(new URL('./ui-fix-prompt.md', import.meta.url), 'utf8');
  fs.writeFileSync(path.join(outDir, 'candidate.json'), JSON.stringify({number: candidate.number, title: candidate.title, id: candidate.labels.map(l => l.name).find(n => n.startsWith('fp:')).slice(3), screenshot: screenshotOf(candidate)}));
  fs.writeFileSync(path.join(outDir, 'prompt.md'), promptFor(candidate, base));
}

export const promptFor = (issue, base) => `${base}\n\n---\nTHE FINDING (issue #${issue.number}):\n${issue.title}\n\n${issue.body}\n`;

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ''; };
  const outDir = option('out') || '.heal';
  fs.mkdirSync(outDir, {recursive: true});
  const result = triage({artifacts: option('artifacts'), runUrl: option('run-url')});
  const lines = [`## UI findings`, `${result.findings.length} finding(s) in this run: ${result.filed.length} new, ${result.again.length} seen again, ${result.gone.length} not seen any more.`];
  // The producer only files and updates issues. The fixer (ui-fix.yml, once a day) picks the most critical one: node pick.mjs.
  if (!args.includes('--file-only')) {
    const candidate = result.candidate;
    if (candidate) { writeCandidate(candidate, outDir); lines.push(`Ready to fix: #${candidate.number} ${candidate.title}`); }
    else lines.push('Nothing is ready to fix.');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${candidate ? candidate.number : 'none'}\n`);
  }
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
