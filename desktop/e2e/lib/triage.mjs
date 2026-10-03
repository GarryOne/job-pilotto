// The self-healing loop's judgement, as plain functions (no network): which findings are worth an issue, which one is ready for a fix, and
// what a fix may touch. triage.mjs (the producer's CLI), pick.mjs (the fixer's) and .github/workflows/ui-findings.yml, ui-fix.yml call these; tests/triage.test.mjs pins the rules.
import {fingerprint, cappedSeverity} from './vision.mjs';

export const LABEL = 'auto-ui';
export const NEEDS_HUMAN = 'needs-human';
export const FALSE_POSITIVE = 'wontfix-auto';
export const CONFIRMED = 'confirmed';   // a person looked at the finding and says it is real: ready without a second sighting
export const NOT_SEEN = 'not-seen-latest';   // the page was photographed and reviewed again and the finding did not come back
export const SEEN_AGAIN = 'seen-again';   // seen on two or more commits (sightings()): reproduced, not a one-off
export const SIGHTINGS_NEEDED = 2;   // a finding must show in two runs before anyone (or anything) acts on it: one-off flakes and model noise drop out
export const FIX_KINDS = ['layout', 'text', 'empty-state', 'consistency', 'error-shown', 'tall-row', 'tall-cell', 'page-overflow', 'clipped-text', 'broken-image', 'spill', 'dead-control', 'expand-broken', 'no-loading-state'];

// Allowed edits of an automatic fix: the window's pages, styles and their tests. Nothing that touches data, Notion, secrets, the engine, the site or workflows.
export const ALLOWED = [/^desktop\/renderer\/[^\n]+$/, /^desktop\/test\/[^\n]+\.test\.js$/];
export const allowedPath = file => ALLOWED.some(pattern => pattern.test(file)) && !file.includes('..');

// ui-findings.json (deterministic) + ai-findings.json (vision) -> one list: {id, view, severity, kind, title, detail, suggestion, source}.
// AI findings rated "low" are noise by experience (about 1 in 16 was real) and are not filed; deterministic "severe" counts as high, "warning" as medium.
// The probe's own grading: a dead or broken control confuses (medium); a call with no sign of work is barely noticeable (low) until the person waits seconds for it (medium).
const SLOW_NOTICEABLE_MS = 3000;
export function probeSeverity(item) {
  if (item.kind !== 'no-loading-state') return 'medium';
  const ms = Number(/ran for (\d+) ms/.exec(item.detail || '')?.[1]);
  return Number.isFinite(ms) && ms >= SLOW_NOTICEABLE_MS ? 'medium' : 'low';
}
export function normalize({ui = [], ai = [], suite = []}) {
  const fromUi = ui.filter(item => item && item.view && item.kind && item.detail).map(item => {
    const probed = item.source === 'interaction-probe';   // a control pressed by the interaction probe: the control is in the title
    const finding = {view: item.view, severity: probed ? probeSeverity(item) : item.severity === 'severe' ? 'high' : 'medium', kind: item.kind,
      title: `${item.kind.replace(/-/g, ' ')} on ${item.view}: ${probed ? `"${item.control}"` : String(item.detail).split(' ')[0]}`, detail: item.detail, suggestion: '', source: probed ? 'interaction-probe' : 'layout-check', dir: item._dir, shot: item.shot};   // the element is in the title: two problems of one page are two issues
    // `shown` is only the issue's title: a layout finding says what is on the page ("spill on settings-narrow: p#cv-message.message: "400 {"type":"error"…""), not just a selector. The fingerprint
    // keeps using `title`, so issues filed before this still match.
    const quoted = !probed && /:\s*"([\s\S]{3,})$/.exec(String(item.detail || ''))?.[1]?.replace(/"$/, '');
    return {...finding, ...(quoted ? {shown: `${finding.title}: "${quoted.replace(/\s+/g, ' ').slice(0, 40)}${quoted.length > 40 ? '…' : ''}"`} : {}), id: fingerprint(finding)};
  });
  const fromAi = ai.filter(item => item && item.view && item.title && item.severity !== 'low').map(item => ({...item, severity: cappedSeverity(item.severity, item.kind), dir: item._dir, id: item.id || fingerprint(item), source: 'ai-review'}));
  // A step of a suite that failed: one finding per step (its message changes from run to run, the step does not). Never a kind a UI fix can address.
  const fromSuite = suite.filter(item => item && item.suite && item.step).map(item => {
    // A red test step says something is off, not that a journey is blocked: that is a judgement (a person's `confirmed`), and the release gate is red anyway while any suite fails.
    // Until 3 Oct 2026 every failed step was filed high: 18 of the 21 "high" issues were test steps, and none blocked anyone.
    const finding = {view: item.suite, severity: 'medium', kind: 'test-failure', title: `step failed: ${item.step}`, detail: String(item.message || 'The step failed.'), suggestion: '', source: 'suite-failure', dir: item._dir, also: item.also || []};
    return {...finding, id: fingerprint(finding)};
  });
  const seen = new Set();
  return [...fromUi, ...fromAi, ...fromSuite].filter(item => !seen.has(item.id) && seen.add(item.id));
}

export const issueTitle = finding => `[auto-ui] ${finding.view}: ${finding.shown || finding.title}`.slice(0, 120);
export const labelFor = id => `fp:${id}`.slice(0, 50);

// Which findings of THIS run keep a build away from beta testers: high severity, and either a deterministic layout check or an AI finding that is already a real
// open issue (seen in two runs, or confirmed by a person). One AI sighting is noise often enough that it alone would block a good build every night. A failed suite
// step is not listed: the gate is already red then.
// An AI finding blocks only when it is about the app being WRONG (a false status, a dead control, an error shown), not about how it looks: the review rated a clipped
// brand name "high" in one issue and "medium" for the same defect in the next (#55 and #56 against #57), and a cosmetic defect must not stop a release.
export const BLOCKING_AI_KINDS = ['functionality', 'error-shown'];
export function blockers(findings, issues) {
  return findings.filter(finding => finding.severity === 'high' && finding.source !== 'suite-failure').filter(finding => {
    if (finding.source === 'layout-check') return true;   // deterministic and "severe" only for a sideways-scrolling page, a row hundreds of pixels tall, a broken image
    if (!BLOCKING_AI_KINDS.includes(finding.kind)) return false;
    const issue = matchExisting(finding, issues);
    return !!issue && (sightings(issue) >= SIGHTINGS_NEEDED || (issue.labels || []).some(item => (item.name || item) === CONFIRMED));
  });
}

// A suite that failed because the AI had no credit says nothing about the product. A suite that tests the spend-limit message on purpose is not read from its logs.
export const NO_CREDIT = /credit balance is too low|spend limit is reached|AI limit reached|usage limits?\b/i;
export const LIMIT_TESTED = ['activityfailures'];

const SOURCE_WORDS = {'layout-check': 'the layout check', 'suite-failure': 'a run of the suite (a step failed)', 'ai-review': 'the AI screenshot review', 'interaction-probe': 'the interaction probe (it pressed the control and recorded what happened)'};
const sourceWords = finding => (finding.source === 'suite-failure' ? `a run of the ${finding.view} suite (a step of the ${finding.view} suite failed)` : SOURCE_WORDS[finding.source] || SOURCE_WORDS['ai-review']);

// The app's own words for its state when the picture was taken (ui-<view>.json), as table rows; empty ones are left out.
const FACT_NAMES = [['page', 'Page'], ['settingsSection', 'Settings section'], ['aiEngineChosen', 'AI engine'], ['anthropicKeySaved', 'API key saved'], ['claudeCodeInstalled', 'Claude Code installed'],
  ['notionConnected', 'Notion connected'], ['setupDone', 'Set up'], ['jobsInList', 'Jobs in the list'], ['jobsUnscored', 'Jobs not scored'], ['situation', 'Situation']];
export function factsRows(facts) {
  return FACT_NAMES.filter(([key]) => facts && facts[key] !== undefined && facts[key] !== '' && facts[key] !== null)
    .map(([key, label]) => [label, typeof facts[key] === 'boolean' ? (facts[key] ? 'yes' : 'no') : String(facts[key])]);
}

// evidence: {suite, screenshot (url), failedScreenshot (url), facts, logs: {name: text}, codeFile, message}
// A fence longer than any run of backticks inside the text, so a log or a command that contains ``` cannot close it early.
export const fence = (text, lang = '') => { const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map(run => run.length)); const mark = '`'.repeat(longest + 1); return `${mark}${lang}\n${String(text).replace(/\n+$/, '')}\n${mark}`; };
// What a test step or a click reported is often a command, a stack or JSON, written over several lines: as plain markdown it collapses into one paragraph and `import` turns bold
// (#93, 3 Oct 2026). A short lead line ("Command failed:") stays prose, the rest goes in a code block. Prose findings (the AI's) are left as they are.
const CODE_SOURCES = ['suite-failure', 'interaction-probe'];
const LOOKS_LIKE_CODE = /\n|[{}]|=>|\bimport\b|\b[A-Za-z]:\\|\/home\/|\bat .+:\d+|Traceback|\bsys\.argv\b/;
export function formatDetail(finding) {
  const text = String(finding.detail || '');
  if (!CODE_SOURCES.includes(finding.source) || (!LOOKS_LIKE_CODE.test(text) && text.length <= 240)) return text;
  const split = /^([^\n:]{3,80}:)\s+([\s\S]+)$/.exec(text);
  return split ? `${split[1]}\n\n${fence(split[2])}` : fence(text);
}
const DOT = {high: '🔴', medium: '🟠', low: '🟡'};
const PLATFORM_NAME = {mac: 'Mac', windows: 'Windows'};
// The first line and the "Build tested:" line are read back by the later steps (severity, kind, the commit, "found by"); the fingerprint comment ends the body.
// Layout (3 Oct 2026, after the owner's review): the verdict line, a three-line "where and on what" block, then what was found, the evidence, how to reproduce it and where to look.
// Wide or secondary facts (the app's state, a seeded run's variation, the logs) sit in collapsed blocks, so the page reads in a few seconds.
export function issueBody(finding, runUrl, evidence = {}) {
  const view = finding.view, suite = evidence.suite || '';
  const picture = evidence.screenshot || evidence.failedScreenshot;
  const rows = factsRows(evidence.facts);
  const logs = Object.entries(evidence.logs || {}).filter(([, text]) => text);
  const platform = PLATFORM_NAME[evidence.platform] || '';
  const out = [`${DOT[finding.severity] || ''} **${finding.severity.toUpperCase()}** · ${finding.kind} · found by ${sourceWords(finding)}`.trim(), ''];
  out.push(`> 📍 Page \`${view}\`${suite ? ` · suite \`${suite}\`` : ''}${platform ? ` · ${platform}` : ''}`);
  if (evidence.build) out.push(`> 🏷️ Build tested: ${evidence.build}`);
  out.push(`> 🔗 First seen: ${runUrl}`, '', '### What was found', formatDetail(finding));
  if (finding.suggestion) out.push('', '### Suggested', finding.suggestion);
  if (picture || rows.length || logs.length) out.push('', '### Evidence');
  if (picture) out.push(`![${view}](${picture})`);
  if (rows.length) out.push('', '<details><summary>App state when this was taken</summary>', '', ...rows.map(([name, value]) => `- **${name}:** ${value}`), '', '</details>');
  if (finding.also?.length) out.push('', '### Failed after it', ...finding.also.slice(0, 8).map(step => `- ${step}`), ...(finding.also.length > 8 ? [`- … and ${finding.also.length - 8} more`] : []), '', '<sub>Probably consequences of the first failure (later steps of the same suite).</sub>');
  for (const [name, text] of logs) out.push('', `<details><summary>${name} (last lines)</summary>`, '', fence(text), '', '</details>');
  if (suite) {
    out.push('', '### Reproduce', fence([`cd desktop/e2e`, `node suite.mjs ${suite}${evidence.seed ? `    # the fixed path` : ''}`, ...(evidence.seed ? [`E2E_SEED=${evidence.seed} node suite.mjs ${suite}    # this run's path`] : [])].join('\n'), 'sh'),
      `The step that photographs \`${view}\` (\`snap(ctx, '${view}')\`) shows it.`);
    if (evidence.seed) out.push('', `<details><summary>Variation of this run: seed ${evidence.seed}${evidence.window ? `, window ${evidence.window.join('x')}` : ''}</summary>`, '',
      ...(evidence.detail ? [`${evidence.detail}`, ''] : []), 'The seed shuffles the pages, the controls and the form data; the same seed replays the same path.', '', '</details>');
  }
  const where = [];
  if (evidence.codeFile) where.push(`- Code: \`${evidence.codeFile}\``);
  if (suite) where.push(`- The run's artifacts: \`e2e-artifacts-${suite}\` (\`ui-${view}.png\`, \`ui-${view}.json\`, the findings files)`);
  if (where.length) out.push('', '### Where to look', ...where);
  out.push('', `<!-- fingerprint: ${finding.id} -->`);
  return out.join('\n');
}

// Labels so the issue list can be filtered by severity, kind, view, suite and where the finding came from.
export const labelsFor = (finding, suite = '') => [`severity:${finding.severity}`, `kind:${finding.kind}`, `view:${finding.view}`.slice(0, 50), ...(suite ? [`suite:${suite}`.slice(0, 50)] : []),
  `source:${finding.source}`];

const buildLine = build => (build ? `\n\nBuild tested: ${build}` : '');
export const seenAgainComment = (runUrl, screenshot = '', build = '') => `Seen again in run ${runUrl}${buildLine(build)}${screenshot ? `\n\n![the page in this run](${screenshot})` : ''}`;
export const notSeenComment = (runUrl, screenshot = '', build = '') => `Not seen in run ${runUrl}: that page was photographed and reviewed again and the finding did not come back (a fix, or a one-off).${buildLine(build)}${screenshot ? `\n\n![the page in this run](${screenshot})` : ''}`;
// Closing: the finding was already "not seen" in an earlier run and a second, later run did not see it either. A person can reopen it; a finding that comes back files a new issue.
export const closedComment = (runUrl, build = '') => `Closed: not seen in two runs in a row (latest ${runUrl}).${buildLine(build)}\n\nIf it comes back, the loop files a new issue.`;

// The app version of the tested code, as a label (`version:0.5.0`) so the issue list can be filtered by it. Until 3 Oct 2026 it was only text in the body, and only when a
// release tag sat on exactly that commit: most tested commits lie between releases, so most issues had no version at all. Now: the newest release that is an ancestor of the
// tested commit (exact when it is that commit). `gh` and the repo are injected; any failure gives null (an issue is never held back for want of a label).
export const versionLabel = version => `version:${version}`.slice(0, 50);
export function appVersionAt(sha, {gh, repo, limit = 12}) {
  if (!sha || !repo) return null;
  try {
    const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=${limit}`, '--jq', '[.[] | select(.draft | not) | {tag: .tag_name}]']));
    for (const {tag} of Array.isArray(releases) ? releases : []) {
      if (!/^desktop-v/.test(tag || '')) continue;
      const status = String(gh(['api', `repos/${repo}/compare/${tag}...${sha}`, '--jq', '.status'])).trim();
      if (status === 'identical' || status === 'ahead') return {version: tag.replace(/^desktop-v/, ''), exact: status === 'identical'};
    }
  } catch { /* no label this time */ }
  return null;
}

// Closed after one clean run because a commit named the issue: says which commit and which run.
export const closedByFixComment = (runUrl, sha, build = '') => `Closed: commit ${sha} says it fixes this, and the latest run did not see it (${runUrl}).${buildLine(build)}\n\nIf it comes back, the loop files a new issue.`;

// The suite a suite-failure issue came from ("found by a run of the apply suite"), else ''.
export const suiteOfIssue = issue => /found by a run of the (\w+) suite/.exec(issue.body || '')?.[1] || '';

// Open issues that earned closing: labelled not-seen-latest, not matched by this run's findings, not already told about this run, and cleared by it.
// `cleared(issue)` says whether this run looked at the issue's page/suite again (the caller knows the artifacts).
export const toClose = (issues, matched, runUrl, cleared) => issues.filter(issue => issue.state === 'OPEN' && !matched.has(issue.number)
  && (issue.labels || []).some(item => (item.name || item) === NOT_SEEN)
  && !(issue.labels || []).some(item => (item.name || item) === CONFIRMED)   // a person said it is real: "not seen" proves nothing (it may only show under a condition, like the API failing, #94), so only a fix closes it
  && !(issue.comments || []).some(comment => (comment.body || '').includes(runUrl)) && cleared(issue));

// A probe issue ("jobs: dead control on jobs: "0Inbound"") is cleared by a run whose probe pressed that same control again and did not flag it. Until 3 Oct 2026 nothing cleared
// them: the check only knew screenshot reviews, so a fixed probe finding stayed open until a pull request named it.
export const probeTarget = issue => {
  if (!(issue.labels || []).some(item => (item.name || item) === 'source:interaction-probe')) return null;
  const view = /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1], control = /"([^"]+)"\s*$/.exec(issue.title || '')?.[1];
  return view && control ? {view, control} : null;
};
export const probeCleared = (issue, pressed) => { const target = probeTarget(issue); return !!target && pressed.some(row => row.view === target.view && row.control === target.control); };

// A commit between the build an issue was first seen on and the build now tested that says "Fixes #N" (also "Closes", "Fixed", "Resolves", lists like "#1, #2"): the fix is known, one clean run is enough.
export const namesIssue = (message, number) => {
  const pattern = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b[:\s]+((?:#\d+[\s,&and]*)+)/gi;
  for (const match of String(message || '').matchAll(pattern)) if ((match[1].match(/#(\d+)/g) || []).some(ref => ref === `#${number}`)) return true;
  return false;
};
export const firstBuildSha = issue => /Build tested: .*? @ ([0-9a-f]{7})/.exec(issue.body || '')?.[1] || '';
export const testedSha = build => /@ ([0-9a-f]{7})/.exec(build || '')?.[1] || '';

// The first picture of an issue (its body, else its newest comment that has one): what a fix pull request shows as "before".
export function screenshotOf(issue) {
  const find = text => /!\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^)\s]+\.png)\)/.exec(text || '')?.[1] || '';
  return find(issue.body) || [...(issue.comments || [])].reverse().map(comment => find(comment.body)).find(Boolean) || '';
}

// The finding's own words in an issue body: the "What was found" section (old bodies had it right after the first line, new ones after a metadata block).
export const foundText = body => { const text = String(body || ''); const at = text.indexOf('### What was found'); return (at >= 0 ? text.slice(at + 18).split('\n###')[0] : text.split('\n').slice(1, 4).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 600); };

// How alike two texts are, 0..1: the share of their words (3+ letters) that both have. The AI words the same problem differently every run.
const wordsOf = text => new Set(String(text || '').toLowerCase().match(/[a-z]{3,}/g) || []);
export function similar(a, b) {
  const x = wordsOf(a), y = wordsOf(b);
  if (!x.size || !y.size) return 0;
  const both = [...x].filter(word => y.has(word)).length;
  return both / (x.size + y.size - both);
}

// The open issue this finding already is: the same fingerprint, else the same view and kind with alike words.
export function matchExisting(finding, issues, threshold = 0.3, state = 'OPEN') {
  const label = labelFor(finding.id);
  const named = issues.find(issue => issue.state === state && (issue.labels || []).some(item => (item.name || item) === label));
  if (named) return named;
  const text = `${finding.title} ${finding.detail}`;
  return issues.filter(issue => issue.state === state && new RegExp(`^\\[auto-ui\\] ${finding.view}:`).test(issue.title || '')
      && (/·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '') === finding.kind)
    .map(issue => ({issue, score: similar(text, `${(issue.title || '').replace(/^\[auto-ui\] [^:]+:/, '')} ${foundText(issue.body)}`)}))
    .filter(item => item.score >= threshold).sort((a, b) => b.score - a.score)[0]?.issue || null;
}

// One sighting per commit: an unchanged commit is looked at up to three times a day (lib/plan.mjs), and a cosmetic finding that shows every time
// filled the fixer's queue (#66 scored 14 from one build, 3 Oct 2026). The commit is the "Build tested: … @ <sha>" line; without one, each sighting counts.
const commitOf = text => /Build tested: .*? @ ([0-9a-f]{7})/.exec(text || '')?.[1] || '';
function sightingKeys(issue, keep = () => true) {
  const keys = new Set(), add = (text, key) => keys.add(commitOf(text) || key);
  if (keep(issue.createdAt)) add(issue.body, 'filed');
  (issue.comments || []).forEach((comment, i) => { if (/^Seen again\b/.test(comment.body || '') && keep(comment.createdAt)) add(comment.body, `seen-${i}`); });
  return keys;
}
// How many commits an issue has been seen on: the finding itself plus each "Seen again" on another commit.
export const sightings = issue => Math.max(1, sightingKeys(issue).size);

// Sightings of an issue in the last `days` days, one per commit: the issue itself (when it was filed that recently) and each "Seen again" comment. Undated ones (older data, tests) count.
export function recentSightings(issue, now = Date.now(), days = 7) {
  return sightingKeys(issue, date => !date || now - Date.parse(date) <= days * 86400000).size;
}
const WEIGHT = {HIGH: 3, MEDIUM: 2, LOW: 1};
// How critical a finding is: its severity times how often it came back this week; a person's "confirmed" doubles it.
export function score(issue, now = Date.now()) {
  const label = (issue.labels || []).map(item => item.name || item);
  const severity = /\*\*(HIGH|MEDIUM|LOW)\*\*/.exec(issue.body || '')?.[1] || 'LOW';
  return WEIGHT[severity] * Math.max(1, recentSightings(issue, now)) * (label.includes(CONFIRMED) ? 2 : 1);
}

// ---- Ranking: where an open issue stands, kept on its labels (priority:P0..P3) and in one pinned list, so the most important are on top without anyone sorting. ----
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const priorityLabel = band => `priority:${band}`;
const BLOCKING_KINDS = ['functionality', 'error-shown', 'test-failure', 'page-overflow', 'tall-row', 'broken-image'];   // the kinds that keep a build from beta (blockers(), tools/canary_promote.py)

// P0 would keep a build from beta or stable (a high, wrong-app finding seen twice this week or confirmed); P1 score 6+ (a high one seen twice, a medium one seen three times);
// P2 score 3+ (a high one seen once, a medium one seen twice); P3 the rest (a medium or low one seen once). score() = severity x sightings this week, doubled by `confirmed`.
export function priorityOf(issue, now = Date.now()) {
  const labels = (issue.labels || []).map(item => item.name || item);
  const severity = /\*\*(HIGH|MEDIUM|LOW)\*\*/.exec(issue.body || '')?.[1] || 'LOW';
  const kind = /·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  const seen = recentSightings(issue, now), points = score(issue, now);
  if (labels.includes(NOT_SEEN)) return 'P3';   // already clean in the latest run: waiting to close, never above the rest
  if (severity === 'HIGH' && BLOCKING_KINDS.includes(kind) && (seen >= 2 || labels.includes(CONFIRMED))) return 'P0';
  return points >= 6 ? 'P1' : points >= 3 ? 'P2' : 'P3';
}

// What breaks the product outranks what is only rough: a wrong result > a dead or broken control > a missing spinner; a crashed test step is the harness, not the product.
// The score alone tied eleven of twelve rows on 3 Oct 2026 (a red status dot ranked like a missing spinner).
const KIND_WEIGHT = {functionality: 3, 'error-shown': 3, 'console-error': 3, 'dead-control': 2, 'expand-broken': 2, 'page-overflow': 2, 'tall-row': 2, 'broken-image': 2, 'no-loading-state': 1, 'test-failure': 0.5};
const CRITICAL_VIEWS = ['apply', 'strategy', 'activity', 'wizard'];   // the critical path: apply, strategy sync, run results, setup
const kindOf = issue => /·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '';
const viewOf = issue => /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1] || '';
export const rankWeight = (issue, now = Date.now()) => score(issue, now) * (KIND_WEIGHT[kindOf(issue)] ?? 1) * (CRITICAL_VIEWS.includes(viewOf(issue)) ? 1.5 : 1);

// -> the open UI-loop issues, most important first: priority, then (already clean last), then weighted score, Mac before Windows (Windows never blocks a release), then the oldest.
// Parked ones (needs-human, wontfix-auto) are left out.
export function rankIssues(issues, now = Date.now()) {
  const has = (issue, name) => (issue.labels || []).some(item => (item.name || item) === name);
  return issues.filter(issue => issue.state === 'OPEN' && !(issue.labels || []).some(item => [NEEDS_HUMAN, FALSE_POSITIVE].includes(item.name || item)))
    .map(issue => ({issue, priority: priorityOf(issue, now), score: score(issue, now), weight: rankWeight(issue, now)}))
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || Number(has(a.issue, NOT_SEEN)) - Number(has(b.issue, NOT_SEEN)) || b.weight - a.weight
      || Number(has(a.issue, 'platform:windows')) - Number(has(b.issue, 'platform:windows')) || a.issue.number - b.issue.number);
}

const lastBuild = issue => [issue.body, ...(issue.comments || []).filter(comment => /^Seen again\b/.test(comment.body || '')).map(comment => comment.body)].map(commitOf).filter(Boolean).at(-1) || '';
const lastSeen = issue => [issue.createdAt, ...(issue.comments || []).filter(comment => /^Seen again\b/.test(comment.body || '')).map(comment => comment.createdAt)].filter(Boolean).sort().at(-1) || '';
// Each detector's record over the last 30 days, from the issues themselves: how many it filed, how many were false positives (wontfix-auto), how many were real
// (confirmed, or closed as completed), how many are still open. With the recall plants (recall.json), this is how "better" is measured, not guessed.
const SOURCE_NAMES = {'ai-review': 'AI screenshot review', 'interaction-probe': 'Interaction probe', 'layout-check': 'Layout and DOM checks', 'suite-failure': 'Failed test steps', 'code-review': 'AI code review', explorer: 'AI explorer'};
export function scorecard(issues, now = Date.now(), days = 30) {
  const rows = {};
  for (const issue of issues || []) {
    if (issue.createdAt && now - Date.parse(issue.createdAt) > days * 86400000) continue;
    const labels = (issue.labels || []).map(item => item.name || item);
    const source = (labels.find(name => name.startsWith('source:')) || '').slice(7);
    if (!source) continue;
    const row = (rows[source] ??= {filed: 0, falsePositive: 0, real: 0, open: 0});
    row.filed++;
    if (labels.includes(FALSE_POSITIVE)) row.falsePositive++;
    else if (labels.includes(CONFIRMED) || (issue.state === 'CLOSED' && issue.stateReason === 'COMPLETED' && !labels.includes(NOT_SEEN))) row.real++;
    if (issue.state === 'OPEN') row.open++;
  }
  return Object.entries(rows).sort((a, b) => b[1].filed - a[1].filed).map(([source, row]) => ({source: SOURCE_NAMES[source] || source, ...row}));
}
export const scorecardLines = rows => (rows.length ? ['', '**Detectors, last 30 days**', '', '| Detector | Filed | False positives | Real | Open |', '|---|---|---|---|---|',
  ...rows.map(row => `| ${row.source} | ${row.filed} | ${row.falsePositive}${row.filed ? ` (${Math.round(100 * row.falsePositive / row.filed)}%)` : ''} | ${row.real} | ${row.open} |`),
  '', '<sub>Real = confirmed by a person or the verdict pass, or closed as fixed. Closed as "not seen" counts as neither. Recall (known bugs planted into the page, caught or not) is in each interactions run\'s summary.</sub>'] : []);
export function rankingBody(ranked, now = Date.now(), limit = 12, card = []) {
  const rows = ranked.slice(0, limit).map(({issue, priority, score: points}, index) => {
    const at = lastSeen(issue), days = at ? Math.floor((now - Date.parse(at)) / 86400000) : null;
    const age = days === null ? '' : days <= 0 ? 'today' : `${days} d ago${days >= 7 ? ' ⚠️' : ''}`;
    const platform = (issue.labels || []).some(item => (item.name || item) === 'platform:windows') ? 'Windows' : 'Mac';
    const clean = (issue.labels || []).some(item => (item.name || item) === NOT_SEEN) ? ' · clean last run' : '';
    return `| ${index + 1} | **${priority}** | #${issue.number} ${String(issue.title || '').replace(/^\[auto-ui\] /, '').replace(/\|/g, '/').slice(0, 80)} | ${platform} | ${points} | ${[lastBuild(issue) ? `\`${lastBuild(issue)}\`` : '?', age].filter(Boolean).join(' · ')}${clean} |`;
  });
  const counts = PRIORITIES.map(band => `${band}: ${ranked.filter(item => item.priority === band).length}`).join(' · ');
  return ['**The open findings, most important first.** Re-ranked after every run.', '', `${counts} · ${ranked.length} open`, '',
    '| # | Priority | Finding | Platform | Score | Last build seen on |', '|---|---|---|---|---|---|', ...(rows.length ? rows : ['| | | nothing open | | | |']),
    '', '**P0** would keep a build from beta or stable · **P1** seen again and again, or high and confirmed · **P2** worth a look · **P3** seen once, or already clean in the latest run. Score = severity × sightings this week (× 2 when a person confirmed it). Within a priority: a wrong result before a dead control before a missing spinner (a crashed test step counts least), the critical path (apply, strategy, activity, setup) first, Mac before Windows. ⚠️ = not seen for 7 days or more. A finding closes after two clean runs of its page, or one when a commit says it fixes it.',
    ...scorecardLines(card), '', '<sub>Written by `desktop/e2e/triage.mjs`. Do not edit by hand.</sub>'].join('\n');
}

// Why an open issue is not ready for a fix ('' = ready): the fixer's rules, in the order they are checked. One place, so the pick and its summary agree.
export const NOT_READY = {
  parked: {why: 'Parked: a person must look (`needs-human`) or it was judged a false positive (`wontfix-auto`)', next: 'Remove the label once it is understood'},
  clean: {why: 'Clean in the latest run (`not-seen-latest`): waiting to close', next: 'Nothing: it closes by itself after another clean run'},
  'pr-open': {why: 'A fix pull request is already open', next: 'Review the pull request: merge it, or close it to let the fixer try again'},
  once: {why: `Seen fewer than ${SIGHTINGS_NEEDED} times this week, and not \`confirmed\` by a person`, next: 'Label it `confirmed` if it is real (`gh issue edit N --add-label confirmed`), or wait for the next sighting'},
  kind: {why: 'A kind a UI change cannot fix (a crashed test step, a console error, a wrong result in the data)', next: 'Fix it by hand: the fixer only edits the window\'s code'},
};
export function notReadyReason(issue, {openBranches = [], now = Date.now()} = {}) {
  const labels = (issue.labels || []).map(label => label.name || label);
  const id = labels.find(name => name.startsWith('fp:'));
  if (issue.state !== 'OPEN' || !labels.includes(LABEL) || !id) return 'not-loop';
  if (labels.includes(NEEDS_HUMAN) || labels.includes(FALSE_POSITIVE)) return 'parked';
  if (labels.includes(NOT_SEEN)) return 'clean';
  if (openBranches.includes(`auto-fix/${id.slice(3)}`)) return 'pr-open';
  if (recentSightings(issue, now) < SIGHTINGS_NEEDED && !labels.includes(CONFIRMED)) return 'once';
  const kind = /·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  return FIX_KINDS.includes(kind) ? '' : 'kind';
}

// Which open issue is ready for a fix: seen twice this week (or confirmed by a person), a kind a UI change can fix, not parked, no pull request open already.
// The most critical first (score), then the oldest.
export function pickCandidate(issues, {openBranches = [], now = Date.now()} = {}) {
  const ready = issues.filter(issue => notReadyReason(issue, {openBranches, now}) === '');
  ready.sort((a, b) => score(b, now) - score(a, now) || a.number - b.number);
  return ready[0] || null;
}

// The fixer's job summary: how many findings are open, which are ready, why each other one was passed over, and the rules.
export function readinessSummary(issues, {openBranches = [], now = Date.now(), candidate = null} = {}) {
  const open = issues.filter(issue => notReadyReason(issue, {openBranches, now}) !== 'not-loop');
  const byReason = {};
  for (const issue of open) (byReason[notReadyReason(issue, {openBranches, now})] ||= []).push(issue);
  const ready = (byReason[''] || []).sort((a, b) => score(b, now) - score(a, now) || a.number - b.number);
  const list = items => items.map(issue => `#${issue.number}`).join(', ');
  const head = candidate
    ? `**Fixing #${candidate.number}** ${candidate.title}${candidate.mode === 'verdict' ? ' (verdict only: judged, not edited)' : ''}`
    : `**Nothing is ready to fix.** ${open.length} open finding(s), none passed the rules below.`;
  const rows = [[{why: 'Ready (most critical first)', next: 'The fixer takes the first one'}, ready], ...Object.keys(NOT_READY).map(key => [NOT_READY[key], byReason[key] || []])]
    .filter(([, items]) => items.length).map(([reason, items]) => `| ${reason.why} | ${items.length} | ${list(items)} | ${reason.next} |`);
  // Nothing picked while findings are open: say plainly what would let the fixer take one now, issue by issue.
  const waiting = byReason.once || [];
  const suggest = !candidate && open.length ? ['**To have one fixed now:**',
    ...(waiting.length ? [`- If ${waiting.length === 1 ? list(waiting) : `one of ${list(waiting)}`} is real, label it \`confirmed\` and run the fixer again: \`gh issue edit ${waiting[0].number} --add-label confirmed && gh workflow run ui-fix.yml\`.`] : []),
    ...((byReason['pr-open'] || []).length ? [`- Review the open fix pull request(s) for ${list(byReason['pr-open'])}.`] : []),
    ...((byReason.parked || []).length ? [`- Look at the parked ${list(byReason.parked)}; remove \`needs-human\` when one is ready for another try.`] : []),
    `- Or lower the bar for every finding: \`SIGHTINGS_NEEDED\` in \`desktop/e2e/lib/triage.mjs\` (now ${SIGHTINGS_NEEDED}; it also decides which findings block a release).`, ''] : [];
  return ['## UI fixer', '', head, '', `${open.length} open finding(s) · ${ready.length} ready`, '',
    '| Status | Count | Issues | To have it picked |', '|---|---|---|---|', ...(rows.length ? rows : ['| No open findings | 0 | | |']), '', ...suggest,
    '<details><summary>The rules</summary>', '',
    `- A finding is ready when it is open, not parked (\`needs-human\`, \`wontfix-auto\`), not clean in the latest run, has no fix pull request open,`,
    `  was seen on at least ${SIGHTINGS_NEEDED} commits in the last 7 days (or a person labelled it \`confirmed\`), and is a kind a UI change can fix.`,
    `- Kinds it fixes: ${FIX_KINDS.join(', ')}.`,
    '- The most critical ready one goes first: severity (high 3, medium 2, low 1) × sightings this week, doubled by `confirmed`; then the oldest.',
    '- At most 4 automatic fix pull requests wait for review at once; one fix per run.', '', '</details>', ''].join('\n');
}

// A change is only proposed if every file is allowed, there is a test among them, and nothing was deleted from the tests.
export function checkChange(files) {
  const bad = files.filter(file => !allowedPath(file));
  if (bad.length) return {ok: false, why: `edits outside the allowed folders: ${bad.join(', ')}`};
  if (!files.some(file => /^desktop\/test\//.test(file))) return {ok: false, why: 'a fix must come with a test'};
  return {ok: true, why: ''};
}

// A finding that a person closed as a false positive (`wontfix-auto`) stays closed: the same fingerprint, or the same view and kind with alike words, however the AI words it now.
export const suppressedBy = (finding, issues) => matchExisting(finding, issues.filter(issue => (issue.labels || []).some(item => (item.name || item) === FALSE_POSITIVE)), 0.3, 'CLOSED');
