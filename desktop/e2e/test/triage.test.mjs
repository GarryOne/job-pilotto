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

test('the most critical goes first: severity times how often it came back (old rule was severity first)', () => {
  const picked = pickCandidate([issue(1, 'a', {comments: 5, severity: 'MEDIUM'}), issue(2, 'b', {comments: 1, severity: 'HIGH'}), issue(3, 'c', {comments: 3, severity: 'HIGH'})]);
  assert.equal(picked.number, 1);   // 2 x 6 = 12, 3 x 4 = 12, 3 x 2 = 6: the tie goes to the older issue
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

test('findings of every suite are read, whatever its folder is called', async () => {
  const {filesNamed} = await import('../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suites-'));
  for (const suite of ['e2e-artifacts-jobs', 'e2e-artifacts-settings']) { fs.mkdirSync(path.join(dir, suite)); fs.writeFileSync(path.join(dir, suite, 'ui-findings.json'), '[]'); }
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-wizard')); fs.writeFileSync(path.join(dir, 'e2e-artifacts-wizard', 'ai-findings.json'), '{"findings":[]}');
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), '[]');   // a planted dry-run finding sits at the top
  const found = filesNamed(dir);
  assert.equal(found['ui-findings.json'].length, 3);
  assert.equal(found['ai-findings.json'].length, 1);
  assert.deepEqual(filesNamed(path.join(dir, 'nowhere')), {'ui-findings.json': [], 'ai-findings.json': [], 'suite-failures.json': []});
});

// A step of a suite that failed is a finding too: filed as an issue so it is not only a red check, never picked for an automatic UI fix.
test('a failed suite step becomes one high finding per step, whatever its message says', () => {
  const out = normalize({suite: [{suite: 'activity', step: 'the AI never answers', message: 'took 90 s'}, {suite: 'activity', step: 'the AI never answers', message: 'took 120 s'}, {suite: 'jobs', step: 'a jobs check', message: 'x'}, {step: 'no suite'}]});
  assert.deepEqual(out.map(item => [item.view, item.kind, item.severity, item.source, item.title]),
    [['activity', 'test-failure', 'high', 'suite-failure', 'step failed: the AI never answers'], ['jobs', 'test-failure', 'high', 'suite-failure', 'step failed: a jobs check']]);
  assert.match(out[0].detail, /took 90 s/);
});

test('a failed step is never ready for an automatic UI fix, however often it is seen', () => {
  const finding = normalize({suite: [{suite: 'activity', step: 's', message: 'm'}]})[0];
  const body = issueBody(finding, 'https://x/runs/1');
  assert.match(body, /a step of the activity suite failed/i);
  assert.equal(pickCandidate([{number: 1, state: 'OPEN', title: 't', body, labels: [{name: 'auto-ui'}, {name: `fp:${finding.id}`}], comments: [{body: 'Seen again in run 2'}, {body: 'Seen again in run 3'}]}]), null);
});

test('suite-failures.json files are read from every suite folder, and a failed step is filed by the CLI', async () => {
  const {filesNamed, triage} = await import('../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failures-'));
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-activity'));
  fs.writeFileSync(path.join(dir, 'e2e-artifacts-activity', 'suite-failures.json'), JSON.stringify([{suite: 'activity', step: 'a step', message: 'boom'}]));
  assert.equal(filesNamed(dir)['suite-failures.json'].length, 1);
  const created = [];
  const gh = args => { if (args[0] === 'issue' && args[1] === 'create') created.push(args[3]); return args[0] === 'issue' && args[1] === 'list' ? '[]' : args[0] === 'pr' ? '[]' : ''; };
  const result = triage({artifacts: dir, runUrl: 'https://x/runs/1', gh});
  assert.deepEqual([result.filed.length, result.candidate], [1, null]);
  assert.match(created[0], /^\[auto-ui\] activity: step failed: a step/);
});

test('a finding of the interaction probe names the control in its title and keeps its source', async () => {
  const {normalize, FIX_KINDS} = await import('../lib/triage.mjs');
  const [finding] = normalize({ui: [{view: 'jobs', severity: 'warning', kind: 'dead-control', control: 'Show more', detail: 'Clicking "Show more" did nothing', source: 'interaction-probe', shot: 'probe-jobs-1'}]});
  assert.equal(finding.title, 'dead control on jobs: "Show more"');
  assert.equal(finding.source, 'interaction-probe');
  assert.equal(finding.shot, 'probe-jobs-1');
  assert.ok(FIX_KINDS.includes('dead-control') && FIX_KINDS.includes('expand-broken'));
});

test('blockers: a high layout-check finding always blocks; a high AI finding only once it is a real open issue; medium and failed steps never', async () => {
  const {blockers} = await import('../lib/triage.mjs');
  const f = (source, severity, id, kind = 'functionality') => ({id, view: 'jobs', severity, kind, title: `t ${id}`, detail: `d ${id}`, source});
  const open = (fp, comments = 0, labels = []) => ({number: 1, state: 'OPEN', title: '[auto-ui] jobs: t', body: '**HIGH** · layout · found by the AI screenshot review', labels: [{name: 'auto-ui'}, {name: `fp:${fp}`}, ...labels.map(name => ({name}))],
    comments: Array.from({length: comments}, () => ({body: 'Seen again in run x'}))});
  assert.equal(blockers([f('layout-check', 'high', 'a')], []).length, 1);
  assert.equal(blockers([f('ai-review', 'high', 'b')], []).length, 0, 'one AI sighting is not enough');
  assert.equal(blockers([f('ai-review', 'high', 'b')], [open('b', 1)]).length, 1, 'seen in two runs');
  assert.equal(blockers([f('ai-review', 'high', 'b')], [open('b', 0, ['confirmed'])]).length, 1, 'a person confirmed it');
  assert.equal(blockers([f('ai-review', 'high', 'b', 'text')], [open('b', 5, ['confirmed'])]).length, 0, 'a clipped brand name is cosmetic, however often it is seen');
  assert.equal(blockers([f('ai-review', 'high', 'b', 'error-shown')], [open('b', 1)]).length, 1);
  assert.equal(blockers([f('ai-review', 'medium', 'c')], [open('c', 3)]).length, 0);
  assert.equal(blockers([f('suite-failure', 'high', 'd')], []).length, 0, 'the gate is already red then');
});

test('a Windows run files its own issues (platform label, its own id) and never marks or closes a Mac issue', async () => {
  const {triage, platformOf} = await import('../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-win-'));
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-windows-jobs'));
  fs.writeFileSync(path.join(dir, 'e2e-artifacts-windows-jobs', 'ui-findings.json'), JSON.stringify([{view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}]));
  fs.writeFileSync(path.join(dir, 'e2e-artifacts-windows-jobs', 'ui-jobs.png'), '');
  const id = normalize({ui: [{view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}]})[0].id;
  // The same finding is open for the Mac, and a Mac layout issue on the same page that this Windows run does not see.
  const mac = [{number: 1, state: 'OPEN', title: '[auto-ui] jobs: tall row', body: '**HIGH** · tall-row · found by the layout check', labels: [{name: 'auto-ui'}, {name: `fp:${id}`}], comments: []},
    {number: 2, state: 'OPEN', title: '[auto-ui] jobs: overflow', body: '**HIGH** · page-overflow · found by the layout check', labels: [{name: 'auto-ui'}, {name: 'fp:other'}], comments: []}];
  const created = [], touched = [];
  const gh = args => {
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(mac);
    if (args[0] === 'pr') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') created.push(args[args.indexOf('--label') + 1]);
    if (args[0] === 'issue' && (['comment', 'close'].includes(args[1]) || (args[1] === 'edit' && args.join(' ').includes('not-seen')))) touched.push(Number(args[2]));   // priority labels are re-ranked for all
    return '';
  };
  const out = triage({artifacts: dir, runUrl: 'https://x/runs/9', gh, platform: 'windows'});
  assert.deepEqual(out.filed, [`${id}-win`]);
  assert.match(created[0], /platform:windows/);
  assert.match(created[0], new RegExp(`fp:${id}-win`));
  assert.deepEqual(touched.filter(n => n === 1 || n === 2), []);   // neither Mac issue was commented on, marked "not seen" or closed
  assert.equal(platformOf(mac[0]), 'mac');
});

test('sightings count once per commit: three looks at one build are one sighting, a second build is the second (#66 scored 14 from one build)', async () => {
  const {sightings, recentSightings} = await import('../lib/triage.mjs');
  const seen = sha => ({body: `Seen again in run https://x/runs/${sha}\n\nBuild tested: main @ ${sha} (schedule run)`});
  const issue = {body: 'x\n\nBuild tested: main @ aaaaaaa (schedule run)', comments: [seen('aaaaaaa'), seen('aaaaaaa')]};
  assert.equal(sightings(issue), 1);
  assert.equal(recentSightings(issue), 1);
  issue.comments.push(seen('bbbbbbb'));
  assert.equal(recentSightings(issue), 2);
  issue.comments.push({body: 'Seen again in run 9\n\nBuild tested: v0.5.254 · main @ bbbbbbb (push run)'});   // the app version in front: still that commit
  assert.equal(recentSightings(issue), 2);
  assert.equal(sightings({body: 'old issue, no build line', comments: [{body: 'Seen again in run 2'}, {body: 'Seen again in run 3'}]}), 3);   // older issues: each run still counts
});

test('the fixer is shown the other open findings of the same kind, so a shared cause is fixed once (#66 and #74)', async () => {
  const {chooseCandidate, promptFor} = await import('../triage.mjs');
  const issue = (number, kind, seen) => ({number, state: 'OPEN', title: `[auto-ui] page ${number}`, createdAt: new Date().toISOString(), body: `**MEDIUM** · ${kind} · found by the interaction probe`,
    labels: [{name: 'auto-ui'}, {name: `fp:f${number}`}], comments: seen.map(sha => ({body: `Seen again in run ${sha}\n\nBuild tested: main @ ${sha}`, createdAt: new Date().toISOString()}))});
  const issues = [issue(66, 'no-loading-state', ['aaaaaaa', 'bbbbbbb']), issue(74, 'no-loading-state', []), issue(70, 'dead-control', [])];
  const gh = args => (args[0] === 'pr' ? '[]' : JSON.stringify(issues));
  const picked = chooseCandidate({gh});
  assert.equal(picked.number, 66);
  assert.deepEqual(picked.siblings, ['#74 [auto-ui] page 74']);
  assert.match(promptFor(picked, 'BASE'), /SAME KIND[\s\S]*#74/);
});
