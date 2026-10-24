// Labels a Finder issue that a fix closed ("Fixes #N"): reads how it was closed and applies lib/fixed-close.mjs. Run by issue-fixed.yml on every closed issue.
//   node desktop/e2e/fixed-close.mjs --issue <number> [--dry-run]      (needs gh; --dry-run says what it would add; GH_REPO or REPO names the repository, default GarryOne/jobadabra)
import {execFileSync} from 'node:child_process';
import {labelsForClose} from './lib/fixed-close.mjs';

const args = process.argv.slice(2);
const number = Number(args[args.indexOf('--issue') + 1]);
if (!number) { console.error('usage: fixed-close.mjs --issue <number>'); process.exit(2); }
const repo = process.env.GH_REPO || process.env.REPO || 'GarryOne/jobadabra';
const [owner, name] = repo.split('/');
const gh = list => execFileSync('gh', list, {encoding: 'utf8'});
const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) {
  stateReason labels(first: 50) { nodes { name } }
  timelineItems(itemTypes: CLOSED_EVENT, last: 1) { nodes { ... on ClosedEvent { closer { __typename ... on Commit { oid url } ... on PullRequest { number merged url } } } } } } } }`;
const issue = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`])).data.repository.issue;
const closer = issue.timelineItems.nodes[0]?.closer || null;
// The paths the fix changed: a fix to the test alone is a test mistake (lib/fixed-close.mjs testOnly). Unknown -> undefined, the real-bug answer.
const filesOf = () => {
  try {
    if (closer?.__typename === 'PullRequest') {
      // The commits of the pull request that name this issue ("Fixes #N"): a pull request often carries other work too (#484 held #350's test fix and two Finder changes).
      const names = new RegExp(`\\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?) #${number}\\b`, 'i');
      const commits = JSON.parse(gh(['api', `repos/${repo}/pulls/${closer.number}/commits`, '--jq', '[.[] | {sha, message: .commit.message}]'])).filter(commit => names.test(commit.message));
      if (commits.length) return commits.flatMap(commit => JSON.parse(gh(['api', `repos/${repo}/commits/${commit.sha}`, '--jq', '[.files[].filename]'])));
      return JSON.parse(gh(['api', `repos/${repo}/pulls/${closer.number}/files`, '--paginate', '--jq', '[.[].filename]']).replace(/\]\s*\[/g, ','));
    }
    if (closer?.__typename === 'Commit') return JSON.parse(gh(['api', `repos/${repo}/commits/${closer.oid}`, '--jq', '[.files[].filename]']));
  } catch { /* unknown */ }
  return undefined;
};
const verdict = labelsForClose({labels: issue.labels.nodes.map(label => label.name), stateReason: issue.stateReason, closer, files: filesOf()});
if (!verdict) { console.log(`#${number}: nothing to label`); process.exit(0); }
if (args.includes('--dry-run')) { console.log(`#${number}: would add ${verdict.add.join(', ') || 'a comment only'}`); process.exit(0); }
const LABELS = {'resolution:fixed': ['0E8A16', 'A fix landed (a commit or a merged pull request)'], 'needs-human': ['D93F0B', 'The UI loop could not fix this by itself']};
for (const label of verdict.add.filter(name => LABELS[name])) gh(['label', 'create', label, '--repo', repo, '--force', '--color', LABELS[label][0], '--description', LABELS[label][1]]);
if (verdict.add.length) gh(['issue', 'edit', String(number), '--repo', repo, ...verdict.add.flatMap(label => ['--add-label', label])]);
gh(['issue', 'comment', String(number), '--repo', repo, '--body', verdict.comment]);
console.log(`#${number}: ${verdict.add.join(', ') || 'a comment only'}`);
