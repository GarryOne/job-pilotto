// The self-healing loop's rules: what is worth an issue, what is ready for a fix, and what a fix may touch.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allowedPath, checkChange, issueBody, issueTitle, normalize, pickCandidate, sightings} from '../lib/triage.mjs';

const issue = (number, fp, {severity = 'MEDIUM', kind = 'layout', comments = 0, state = 'OPEN', labels = []} = {}) => ({number, state,
  labels: [{name: 'auto-ui'}, {name: `fp:${fp}`}, ...labels.map(name => ({name}))],
  body: `**${severity}** · ${kind} · found by the AI screenshot review\n\ntext`, comments: Array.from({length: comments}, () => ({body: 'Seen again in run x'}))});

test('layout-check findings count as high or medium; AI findings rated low are not filed; duplicates collapse', () => {
  const out = normalize({
    ui: [{view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}, {view: 'jobs', severity: 'warning', kind: 'clipped-text', detail: 'cut off'}, {view: 'jobs', kind: 'x'}],
    ai: [{view: 'settings', severity: 'low', kind: 'layout', title: 'minor', detail: 'x'}, {view: 'settings', severity: 'high', kind: 'layout', title: 'Cards cover the form', detail: 'y', id: 'settings-layout-1'},
      {view: 'settings', severity: 'high', kind: 'layout', title: 'Cards cover the form', detail: 'y again', id: 'settings-layout-1'}]});
  assert.deepEqual(out.map(item => [item.view, item.severity, item.source]), [['jobs', 'high', 'layout-check'], ['jobs', 'medium', 'layout-check'], ['settings', 'high', 'ai-review']]);
});

test('an issue is ready only after two sightings, for a kind a UI fix can address, with no pull request already open', () => {
  assert.equal(pickCandidate([issue(1, 'a')]), null, 'one sighting is not enough');
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1})])?.number, 1);
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, kind: 'functionality'})]), null, 'functionality needs a person');
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1})], {openBranches: ['auto-fix/a']}), null);
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, labels: ['wontfix-auto']})]), null, 'a false positive stays closed');
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, labels: ['needs-human']})]), null);
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, state: 'CLOSED'})]), null);
});

test('the most severe finding goes first, then the most often seen', () => {
  const picked = pickCandidate([issue(1, 'a', {comments: 5, severity: 'MEDIUM'}), issue(2, 'b', {comments: 1, severity: 'HIGH'}), issue(3, 'c', {comments: 3, severity: 'HIGH'})]);
  assert.equal(picked.number, 3);
});

test('a fix may only touch the window and its tests, and must come with a test', () => {
  assert.equal(allowedPath('desktop/renderer/pages/jobs.js'), true);
  assert.equal(allowedPath('desktop/test/jobs-view.test.js'), true);
  for (const file of ['desktop/main.js', 'desktop/lib/notion.js', 'src/ai/score.py', '.github/workflows/e2e.yml', 'site/src/index.js', 'desktop/renderer/../main.js', 'desktop/test/helper.js']) assert.equal(allowedPath(file), false, file);
  assert.equal(checkChange(['desktop/renderer/pages/jobs.js']).ok, false);
  assert.equal(checkChange(['desktop/renderer/pages/jobs.js', 'desktop/test/jobs-view.test.js']).ok, true);
  assert.match(checkChange(['desktop/main.js', 'desktop/test/a.test.js']).why, /outside/);
});

test('issue text carries the fingerprint, severity and kind that the later steps read back', () => {
  const finding = {id: 'jobs-layout-abc', view: 'jobs', severity: 'high', kind: 'layout', title: 'Location cell 20 lines tall', detail: 'The row is 700px tall.', suggestion: 'Show two places.', source: 'ai-review'};
  assert.match(issueTitle(finding), /^\[auto-ui\] jobs: Location cell/);
  const body = issueBody(finding, 'https://github.com/x/actions/runs/1');
  assert.match(body, /\*\*HIGH\*\* · layout · found by the AI screenshot review/);
  assert.match(body, /fingerprint: jobs-layout-abc/);
  assert.equal(sightings({comments: [{body: 'Seen again in run 2'}, {body: 'a person wrote this'}]}), 2);
});

test('the CLI files new findings, comments on repeats once per run, and returns the issue that is ready', async () => {
  const {triage} = await import('../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-'));
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), JSON.stringify([{view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}]));
  const {normalize} = await import('../lib/triage.mjs');
  const id = normalize({ui: JSON.parse(fs.readFileSync(path.join(dir, 'ui-findings.json'), 'utf8'))})[0].id;
  const calls = [];
  let stored = [];
  const gh = args => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(stored);
    if (args[0] === 'pr') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') { stored = [{number: 7, state: 'OPEN', title: 't', body: '**HIGH** · tall-row · found by the layout check', labels: [{name: 'auto-ui'}, {name: `fp:${id}`}], comments: []}]; }
    if (args[0] === 'issue' && args[1] === 'comment') stored[0].comments.push({body: args[4]});
    return '';
  };
  const first = triage({artifacts: dir, runUrl: 'https://x/runs/1', gh});
  assert.deepEqual([first.filed.length, first.again.length, first.candidate], [1, 0, null]);   // seen once: not ready
  const second = triage({artifacts: dir, runUrl: 'https://x/runs/2', gh});
  assert.deepEqual([second.filed.length, second.again.length, second.candidate?.number], [0, 1, 7]);   // seen twice: ready
  const repeat = triage({artifacts: dir, runUrl: 'https://x/runs/2', gh});
  assert.equal(repeat.again.length, 0);   // the same run never counts twice
});
