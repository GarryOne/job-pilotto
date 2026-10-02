// The self-healing loop's judgement, as plain functions (no network): which findings are worth an issue, which one is ready for a fix, and
// what a fix may touch. triage.mjs (the CLI) and .github/workflows/ui-heal.yml call these; tests/triage.test.mjs pins the rules.
import {fingerprint} from './vision.mjs';

export const LABEL = 'auto-ui';
export const NEEDS_HUMAN = 'needs-human';
export const FALSE_POSITIVE = 'wontfix-auto';
export const CONFIRMED = 'confirmed';   // a person looked at the finding and says it is real: ready without a second sighting
export const NOT_SEEN = 'not-seen-latest';   // the page was photographed and reviewed again and the finding did not come back
export const SIGHTINGS_NEEDED = 2;   // a finding must show in two runs before anyone (or anything) acts on it: one-off flakes and model noise drop out
export const FIX_KINDS = ['layout', 'text', 'empty-state', 'consistency', 'error-shown', 'tall-row', 'tall-cell', 'page-overflow', 'clipped-text', 'broken-image'];
const RANK = {high: 3, medium: 2, low: 1};

// Allowed edits of an automatic fix: the window's pages, styles and their tests. Nothing that touches data, Notion, secrets, the engine, the site or workflows.
export const ALLOWED = [/^desktop\/renderer\/[^\n]+$/, /^desktop\/test\/[^\n]+\.test\.js$/];
export const allowedPath = file => ALLOWED.some(pattern => pattern.test(file)) && !file.includes('..');

// ui-findings.json (deterministic) + ai-findings.json (vision) -> one list: {id, view, severity, kind, title, detail, suggestion, source}.
// AI findings rated "low" are noise by experience (about 1 in 16 was real) and are not filed; deterministic "severe" counts as high, "warning" as medium.
export function normalize({ui = [], ai = [], suite = []}) {
  const fromUi = ui.filter(item => item && item.view && item.kind && item.detail).map(item => {
    const finding = {view: item.view, severity: item.severity === 'severe' ? 'high' : 'medium', kind: item.kind,
      title: `${item.kind.replace(/-/g, ' ')} on ${item.view}`, detail: item.detail, suggestion: '', source: 'layout-check', dir: item._dir};
    return {...finding, id: fingerprint(finding)};
  });
  const fromAi = ai.filter(item => item && item.view && item.title && item.severity !== 'low').map(item => ({...item, dir: item._dir, id: item.id || fingerprint(item), source: 'ai-review'}));
  // A step of a suite that failed: one finding per step (its message changes from run to run, the step does not). Never a kind a UI fix can address.
  const fromSuite = suite.filter(item => item && item.suite && item.step).map(item => {
    const finding = {view: item.suite, severity: 'high', kind: 'test-failure', title: `step failed: ${item.step}`, detail: String(item.message || 'The step failed.'), suggestion: '', source: 'suite-failure', dir: item._dir};
    return {...finding, id: fingerprint(finding)};
  });
  const seen = new Set();
  return [...fromUi, ...fromAi, ...fromSuite].filter(item => !seen.has(item.id) && seen.add(item.id));
}

export const issueTitle = finding => `[auto-ui] ${finding.view}: ${finding.title}`.slice(0, 120);
export const labelFor = id => `fp:${id}`.slice(0, 50);

const SOURCE_WORDS = {'layout-check': 'the layout check', 'suite-failure': 'a run of the suite (a step failed)', 'ai-review': 'the AI screenshot review'};
const sourceWords = finding => (finding.source === 'suite-failure' ? `a run of the ${finding.view} suite (a step of the ${finding.view} suite failed)` : SOURCE_WORDS[finding.source] || SOURCE_WORDS['ai-review']);

// The app's own words for its state when the picture was taken (ui-<view>.json), as table rows; empty ones are left out.
const FACT_NAMES = [['page', 'Page'], ['settingsSection', 'Settings section'], ['aiEngineChosen', 'AI engine'], ['anthropicKeySaved', 'API key saved'], ['claudeCodeInstalled', 'Claude Code installed'],
  ['notionConnected', 'Notion connected'], ['setupDone', 'Set up'], ['jobsInList', 'Jobs in the list'], ['jobsUnscored', 'Jobs not scored'], ['situation', 'Situation']];
export function factsRows(facts) {
  return FACT_NAMES.filter(([key]) => facts && facts[key] !== undefined && facts[key] !== '' && facts[key] !== null)
    .map(([key, label]) => [label, typeof facts[key] === 'boolean' ? (facts[key] ? 'yes' : 'no') : String(facts[key])]);
}

// evidence: {suite, screenshot (url), failedScreenshot (url), facts, logs: {name: text}, codeFile, message}
export function issueBody(finding, runUrl, evidence = {}) {
  const view = finding.view, suite = evidence.suite || '';
  const picture = evidence.screenshot || evidence.failedScreenshot;
  const rows = factsRows(evidence.facts);
  const logs = Object.entries(evidence.logs || {}).filter(([, text]) => text);
  const out = [`**${finding.severity.toUpperCase()}** · ${finding.kind} · found by ${sourceWords(finding)}`, '', '### What was found', finding.detail];
  if (finding.suggestion) out.push('', '### Suggested', finding.suggestion);
  if (picture || rows.length || logs.length) out.push('', '### Evidence');
  if (picture) out.push(`![${view}](${picture})`, `<sub>${suite ? `Suite \`${suite}\` · ` : ''}page \`${view}\` · ${runUrl}</sub>`);
  if (rows.length) out.push('', '| App state | |', '|---|---|', ...rows.map(([name, value]) => `| ${name} | ${value} |`));
  for (const [name, text] of logs) out.push('', `<details><summary>${name} (last lines)</summary>`, '', '```', text, '```', '', '</details>');
  if (suite) out.push('', '### Reproduce', `\`cd desktop/e2e && node suite.mjs ${suite}\`: the step that photographs \`${view}\` (\`snap(ctx, '${view}')\`) shows it.`);
  const where = [];
  if (evidence.codeFile) where.push(`- Code: \`${evidence.codeFile}\``);
  if (suite) where.push(`- The run's artifacts: \`e2e-artifacts-${suite}\` (\`ui-${view}.png\`, \`ui-${view}.json\`, the findings files)`);
  if (where.length) out.push('', '### Where to look', ...where);
  out.push('', `First seen: ${runUrl}`, '', `<!-- fingerprint: ${finding.id} -->`);
  return out.join('\n');
}

// Labels so the issue list can be filtered by severity, kind, view, suite and where the finding came from.
export const labelsFor = (finding, suite = '') => [`severity:${finding.severity}`, `kind:${finding.kind}`, `view:${finding.view}`.slice(0, 50), ...(suite ? [`suite:${suite}`.slice(0, 50)] : []),
  `source:${finding.source}`];

export const seenAgainComment = (runUrl, screenshot = '') => `Seen again in run ${runUrl}${screenshot ? `\n\n![the page in this run](${screenshot})` : ''}`;
export const notSeenComment = (runUrl, screenshot = '') => `Not seen in run ${runUrl}: that page was photographed and reviewed again and the finding did not come back (a fix, or a one-off).${screenshot ? `\n\n![the page in this run](${screenshot})` : ''}`;

// The first picture of an issue (its body, else its newest comment that has one): what a fix pull request shows as "before".
export function screenshotOf(issue) {
  const find = text => /!\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^)\s]+\.png)\)/.exec(text || '')?.[1] || '';
  return find(issue.body) || [...(issue.comments || [])].reverse().map(comment => find(comment.body)).find(Boolean) || '';
}

// How alike two texts are, 0..1: the share of their words (3+ letters) that both have. The AI words the same problem differently every run.
const wordsOf = text => new Set(String(text || '').toLowerCase().match(/[a-z]{3,}/g) || []);
export function similar(a, b) {
  const x = wordsOf(a), y = wordsOf(b);
  if (!x.size || !y.size) return 0;
  const both = [...x].filter(word => y.has(word)).length;
  return both / (x.size + y.size - both);
}

// The open issue this finding already is: the same fingerprint, else the same view and kind with alike words.
export function matchExisting(finding, issues, threshold = 0.3) {
  const label = labelFor(finding.id);
  const named = issues.find(issue => issue.state === 'OPEN' && (issue.labels || []).some(item => (item.name || item) === label));
  if (named) return named;
  const text = `${finding.title} ${finding.detail}`;
  return issues.filter(issue => issue.state === 'OPEN' && new RegExp(`^\\[auto-ui\\] ${finding.view}:`).test(issue.title || '')
      && (/·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '') === finding.kind)
    .map(issue => ({issue, score: similar(text, `${(issue.title || '').replace(/^\[auto-ui\] [^:]+:/, '')} ${String(issue.body || '').split('\n').slice(1, 4).join(' ')}`)}))
    .filter(item => item.score >= threshold).sort((a, b) => b.score - a.score)[0]?.issue || null;
}

// How many nights an issue has been seen: the finding itself plus one "Seen again" comment per later run.
export const sightings = issue => 1 + (issue.comments || []).filter(comment => /^Seen again\b/.test(comment.body || '')).length;

// Which open issue is ready for a fix: seen often enough, a kind a UI change can fix, not parked for a person, no pull request open already.
// Highest severity first, then the most sightings, then the oldest.
export function pickCandidate(issues, {openBranches = []} = {}) {
  const ready = issues.filter(issue => {
    const labels = (issue.labels || []).map(label => label.name || label);
    const id = labels.find(name => name.startsWith('fp:'));
    if (issue.state !== 'OPEN' || !labels.includes(LABEL) || !id) return false;
    if (labels.includes(NEEDS_HUMAN) || labels.includes(FALSE_POSITIVE) || labels.includes(NOT_SEEN)) return false;
    if (openBranches.includes(`auto-fix/${id.slice(3)}`)) return false;
    if (sightings(issue) < SIGHTINGS_NEEDED && !labels.includes(CONFIRMED)) return false;
    const kind = /·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '';
    return FIX_KINDS.includes(kind);
  });
  const severity = issue => (/\*\*(HIGH|MEDIUM|LOW)\*\*/.exec(issue.body || '')?.[1] || 'LOW').toLowerCase();
  ready.sort((a, b) => RANK[severity(b)] - RANK[severity(a)] || sightings(b) - sightings(a) || a.number - b.number);
  return ready[0] || null;
}

// A change is only proposed if every file is allowed, there is a test among them, and nothing was deleted from the tests.
export function checkChange(files) {
  const bad = files.filter(file => !allowedPath(file));
  if (bad.length) return {ok: false, why: `edits outside the allowed folders: ${bad.join(', ')}`};
  if (!files.some(file => /^desktop\/test\//.test(file))) return {ok: false, why: 'a fix must come with a test'};
  return {ok: true, why: ''};
}
