// Labels a Finder issue that a fix closed ("Fixes #N"): reads how it was closed and applies lib/fixed-close.mjs. Run by issue-fixed.yml on every closed issue.
//   node desktop/e2e/fixed-close.mjs --issue <number>      (needs gh; GH_REPO or REPO names the repository, default GarryOne/job-pilotto)
import {execFileSync} from 'node:child_process';
import {labelsForClose} from './lib/fixed-close.mjs';

const args = process.argv.slice(2);
const number = Number(args[args.indexOf('--issue') + 1]);
if (!number) { console.error('usage: fixed-close.mjs --issue <number>'); process.exit(2); }
const repo = process.env.GH_REPO || process.env.REPO || 'GarryOne/job-pilotto';
const [owner, name] = repo.split('/');
const gh = list => execFileSync('gh', list, {encoding: 'utf8'});
const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) {
  stateReason labels(first: 50) { nodes { name } }
  timelineItems(itemTypes: CLOSED_EVENT, last: 1) { nodes { ... on ClosedEvent { closer { __typename ... on Commit { oid url } ... on PullRequest { number merged url } } } } } } } }`;
const issue = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`])).data.repository.issue;
const verdict = labelsForClose({labels: issue.labels.nodes.map(label => label.name), stateReason: issue.stateReason, closer: issue.timelineItems.nodes[0]?.closer || null});
if (!verdict) { console.log(`#${number}: nothing to label`); process.exit(0); }
gh(['label', 'create', 'resolution:fixed', '--repo', repo, '--force', '--color', '0E8A16', '--description', 'A fix landed (a commit or a merged pull request)']);
gh(['issue', 'edit', String(number), '--repo', repo, ...verdict.add.flatMap(label => ['--add-label', label])]);
gh(['issue', 'comment', String(number), '--repo', repo, '--body', verdict.comment]);
console.log(`#${number}: ${verdict.add.join(', ')}`);
