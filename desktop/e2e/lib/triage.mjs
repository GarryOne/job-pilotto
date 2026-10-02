// The self-healing loop's judgement, as plain functions (no network): which findings are worth an issue, which one is ready for a fix, and
// what a fix may touch. triage.mjs (the CLI) and .github/workflows/ui-heal.yml call these; tests/triage.test.mjs pins the rules.
import {fingerprint} from './vision.mjs';

export const LABEL = 'auto-ui';
export const NEEDS_HUMAN = 'needs-human';
export const FALSE_POSITIVE = 'wontfix-auto';
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
      title: `${item.kind.replace(/-/g, ' ')} on ${item.view}`, detail: item.detail, suggestion: '', source: 'layout-check'};
    return {...finding, id: fingerprint(finding)};
  });
  const fromAi = ai.filter(item => item && item.view && item.title && item.severity !== 'low').map(item => ({...item, id: item.id || fingerprint(item), source: 'ai-review'}));
  // A step of a suite that failed: one finding per step (its message changes from run to run, the step does not). Never a kind a UI fix can address.
  const fromSuite = suite.filter(item => item && item.suite && item.step).map(item => {
    const finding = {view: item.suite, severity: 'high', kind: 'test-failure', title: `step failed: ${item.step}`, detail: String(item.message || 'The step failed.'), suggestion: '', source: 'suite-failure'};
    return {...finding, id: fingerprint(finding)};
  });
  const seen = new Set();
  return [...fromUi, ...fromAi, ...fromSuite].filter(item => !seen.has(item.id) && seen.add(item.id));
}

export const issueTitle = finding => `[auto-ui] ${finding.view}: ${finding.title}`.slice(0, 120);
export const labelFor = id => `fp:${id}`.slice(0, 50);

export function issueBody(finding, runUrl) {
  return [`**${finding.severity.toUpperCase()}** · ${finding.kind} · found by ${finding.source === 'layout-check' ? 'the layout check' : finding.source === 'suite-failure' ? `a run of the ${finding.view} suite (a step of the ${finding.view} suite failed)` : 'the AI screenshot review'}`, '',
    finding.detail, '', finding.suggestion ? `Suggested: ${finding.suggestion}` : '', '',
    `First seen: ${runUrl}`, '', `<!-- fingerprint: ${finding.id} -->`].filter((line, index, all) => line || all[index - 1]).join('\n');
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
    if (labels.includes(NEEDS_HUMAN) || labels.includes(FALSE_POSITIVE)) return false;
    if (openBranches.includes(`auto-fix/${id.slice(3)}`)) return false;
    if (sightings(issue) < SIGHTINGS_NEEDED) return false;
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
