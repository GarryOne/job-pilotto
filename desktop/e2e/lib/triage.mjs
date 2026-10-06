// The self-healing loop's judgement, as plain functions (no network): which findings are worth an issue, which one is ready for a fix, and
// what a fix may touch. triage.mjs (the producer's CLI), pick.mjs (the fixer's) and .github/workflows/ui-findings.yml, ui-fix.yml call these; tests/triage.test.mjs pins the rules.
import {replayBlock, replayCommand, replayComment} from './replay.mjs';
import {afterEpoch} from './stats-epoch.mjs';
import {fingerprint, cappedSeverity} from './vision.mjs';

export const LABEL = 'auto-ui';
export const NEEDS_HUMAN = 'needs-human';
export const FALSE_POSITIVE = 'wontfix-auto';
export const CONFIRMED = 'confirmed';   // a person looked at the finding and says it is real: ready without a second sighting
export const NOT_SEEN = 'not-seen-latest';   // the page was photographed and reviewed again and the finding did not come back
export const SEEN_AGAIN = 'seen-again';   // seen on two or more commits (sightings()): reproduced, not a one-off
export const SIGHTINGS_NEEDED = 2;   // a finding must show in two runs before anyone (or anything) acts on it: one-off flakes and model noise drop out
export const LOGIC_KINDS = ['functionality', 'crash'];   // fixable since 4 Oct 2026, only when confirmed (notReadyReason)
export const FIX_KINDS = ['a11y', 'layout', 'text', 'empty-state', 'consistency', 'error-shown', 'tall-row', 'tall-cell', 'page-overflow', 'clipped-text', 'broken-image', 'spill', 'dead-control', 'expand-broken', 'no-loading-state', 'distorted-spinner'];

// Allowed edits of an automatic fix: the window's pages, styles and their tests. Nothing that touches data, Notion, secrets, the engine, the site or workflows.
// Since 4 Oct 2026 also the engine (src/*.py) and the app's own logic (desktop/lib/*.js), with their tests: confirmed logic bugs from the AI code review (#109, #110)
// had to be fixed by hand. Never: workflows, tools, the extension, packaging, the e2e harness, main.js, or anything about secrets, licences, sign-in or tokens.
export const ALLOWED = [/^desktop\/renderer\/[^\n]+$/, /^desktop\/test\/[^\n]+\.test\.js$/, /^src\/[^\n]+\.py$/, /^tests\/test_[^\n/]+\.py$/, /^desktop\/lib\/[^\n]+\.js$/];
const SENSITIVE = /secret|keychain|licen[cs]e|oauth|token|credential|crash_reporting/i;
export const allowedPath = file => ALLOWED.some(pattern => pattern.test(file)) && !file.includes('..') && !SENSITIVE.test(file);

// ui-findings.json (deterministic) + ai-findings.json (vision) -> one list: {id, view, severity, kind, title, detail, suggestion, source}.
// AI findings rated "low" are noise by experience (about 1 in 16 was real) and are not filed; deterministic "severe" counts as high, "warning" as medium.
// The probe's own grading: a dead or broken control confuses (medium); a call with no sign of work is barely noticeable (low) until the person waits seconds for it (medium).
const SLOW_NOTICEABLE_MS = 3000;
// A deterministic check's own words, in the owner's levels: an exact severe check is high; of the warnings, tiny text and a tall table cell are polish, the rest confuse a little.
// A page that states a wrong result about itself (`wrong-result`) is high: it misleads the person (the owner's definition). Deterministic, so it is never low.
export const layoutSeverity = item => item.severity === 'severe' || item.kind === 'wrong-result' ? 'high' : ['tiny-text', 'tall-cell'].includes(item.kind) ? 'low' : item.kind === 'a11y' ? a11ySeverity(item) : 'medium';
// axe's own impact, through a job seeker's eyes (owner, 4 Oct 2026, on #146: a link at 4.0:1 instead of 4.5:1 is not a medium): only a critical barrier (a control no keyboard or screen reader can use)
// is worth an issue (medium); serious, moderate and minor are low, so they are not filed. The contrast fixes still happen when someone touches that CSS.
export const a11ySeverity = item => { const impact = /\d+ element\(s\), (critical|serious|moderate|minor)/.exec(item.detail || '')?.[1]; return impact ? (impact === 'critical' ? 'medium' : 'low') : 'medium'; };
export function probeSeverity(item) {
  if (item.kind !== 'no-loading-state') return 'medium';
  const ms = Number(/ran for (\d+) ms/.exec(item.detail || '')?.[1]);
  return Number.isFinite(ms) && ms >= SLOW_NOTICEABLE_MS ? 'medium' : 'low';
}
// The window around every page (sidebar, bottom bar, brand, icon rail) looks the same on every page, so the AI review reported one sidebar defect once per page:
// nine issues for one cut-off icon (4 Oct 2026). Such a finding goes to view "app-chrome" with a key made of its words (synonyms folded), however it is worded.
const CHROME = /\b(?:sidebar|side bar|status bar|bottom bar|icon rail|brand|activity bar)\b/i;
const CHROME_WORDS = {sidebar: 'sidebar', 'side bar': 'sidebar', 'status bar': 'bottom', 'bottom bar': 'bottom', 'activity bar': 'bottom', 'icon rail': 'sidebar', brand: 'brand',
  icon: 'icon', icons: 'icon', badge: 'badge', badges: 'badge', label: 'label', search: 'search', bottom: 'bottom', footer: 'bottom', last: 'bottom', top: 'top',
  clipped: 'clipped', cut: 'clipped', truncated: 'clipped', hidden: 'clipped', overlap: 'overlap', overlaps: 'overlap', covers: 'overlap', covered: 'overlap', misaligned: 'misaligned'};
export function chromeKey(item) {
  const text = `${item.title || ''} ${item.detail || ''}`;
  if (!CHROME.test(item.title || '')) return '';
  const words = new Set(Object.entries(CHROME_WORDS).filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(text)).map(([, key]) => key));
  return [...words].sort().join('-').slice(0, 40);
}
// One problem told twice by the AI review in ONE run (same page, same kind, other words: #270 and #271, 7 seconds apart) is one issue: the most severe stays, the
// others become lines of its detail so nothing is lost. The fingerprint cannot do this: it hashes the title, which the AI words differently each time.
const RANK = {high: 0, medium: 1, low: 2};
export function mergeSameRun(findings) {
  const groups = new Map();
  for (const item of findings) { const key = `${item.view}|${item.kind}`; (groups.get(key) || groups.set(key, []).get(key)).push(item); }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3));
    const [keep, ...rest] = group;
    keep.detail = `${keep.detail}\n\nAlso told on this page in the same run: ${rest.map(item => `"${item.title}"`).join('; ')}.`;
    for (const item of rest) findings.splice(findings.indexOf(item), 1);
  }
  return findings;
}

// A console error is the window's, not a page's: one error in shared code (components.js) is thrown on every page that uses it, and was filed once per page (#307 and #308,
// the same "within.contains is not a function"). Its id is its words (numbers folded), whatever the page; copies on other pages in the same run become one line of its detail,
// and a later run that sees it on any page matches the same issue.
export const consoleKey = item => {
  const words = String(item.detail || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  let hash = 5381;
  for (const char of words) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `window-console-error-${hash.toString(36)}`;
};
export function mergeConsoleErrors(findings) {
  const first = new Map();
  for (const item of [...findings]) {
    if (item.kind !== 'console-error') continue;
    const keep = first.get(item.id);
    if (!keep) { first.set(item.id, item); continue; }
    if (keep.view !== item.view && !(keep.alsoOn || []).includes(item.view)) keep.alsoOn = [...(keep.alsoOn || []), item.view];
    findings.splice(findings.indexOf(item), 1);
  }
  for (const item of first.values()) if (item.alsoOn?.length) item.detail = `${item.detail}\n\nAlso thrown on: ${item.alsoOn.join(', ')} (one error of the window, not of one page).`;
  return findings;
}
export function normalize({ui = [], ai = [], suite = [], dropped = []}) {
  const fromUi = ui.filter(item => item && item.view && item.kind && item.detail).map(item => {
    const probed = item.source === 'interaction-probe';   // a control pressed by the interaction probe: the control is in the title
    const explored = item.source === 'explorer';   // a bug the AI explorer met AND a script proved again without AI (lib/explore.mjs): its own title and severity
    const finding = {view: item.view, severity: explored ? cappedSeverity(['high', 'medium', 'low'].includes(item.severity) ? item.severity : 'medium', item.kind) : probed ? probeSeverity(item) : layoutSeverity(item), kind: item.kind,
      title: explored ? `${item.kind.replace(/-/g, ' ')} on ${item.view}: ${String(item.title || '').slice(0, 60)}` : `${item.kind.replace(/-/g, ' ')} on ${item.view}: ${probed ? `"${item.control}"` : String(item.detail).split(' ')[0]}`, detail: item.detail, suggestion: '', source: explored ? 'explorer' : probed ? 'interaction-probe' : 'layout-check', dir: item._dir, shot: item.shot};   // the element is in the title: two problems of one page are two issues
    // `shown` is only the issue's title: a layout finding says what is on the page ("spill on settings-narrow: p#cv-message.message: "400 {"type":"error"…""), not just a selector. The fingerprint
    // keeps using `title`, so issues filed before this still match.
    const quoted = !probed && /:\s*"([\s\S]{3,})$/.exec(String(item.detail || ''))?.[1]?.replace(/"$/, '');
    return {...finding, ...(quoted ? {shown: `${finding.title}: "${quoted.replace(/\s+/g, ' ').slice(0, 40)}${quoted.length > 40 ? '…' : ''}"`} : {}), id: finding.kind === 'console-error' ? consoleKey(finding) : fingerprint(finding)};
  });
  mergeConsoleErrors(fromUi);
  const fromAi = ai.filter(item => item && item.view && item.title && item.severity).map(item => {
    const chrome = chromeKey(item);
    return {...item, severity: cappedSeverity(item.severity, item.kind, item.workaround), dir: item._dir, source: 'ai-review', ...(chrome ? {view: 'app-chrome', id: `app-chrome-${item.kind}-${chrome}`} : {id: item.id || fingerprint(item)})};
  });
  // A step of a suite that failed: one finding per step (its message changes from run to run, the step does not). Never a kind a UI fix can address.
  const fromSuite = suite.filter(item => item && item.suite && item.step).map(item => {
    // A red test step says something is off, not that a journey is blocked: that is a judgement (a person's `confirmed`), and the release gate is red anyway while any suite fails.
    // Until 3 Oct 2026 every failed step was filed high: 18 of the 21 "high" issues were test steps, and none blocked anyone.
    const finding = {...(item.flaky ? {flaky: true} : {}), view: item.suite, severity: 'medium', kind: 'test-failure', title: `step failed: ${item.step}`, detail: String(item.message || 'The step failed.'), suggestion: '', source: 'suite-failure', dir: item._dir, also: item.also || []};
    return {...finding, id: fingerprint(finding)};
  });
  const seen = new Set();
  mergeSameRun(fromAi);
  // Only medium and high are filed (owner, 4 Oct 2026: "if we assess it as low, let's not open it"): a low finding is not worth an issue, a review or a fix.
  const all = [...fromUi, ...fromAi, ...fromSuite];
  for (const item of all) if (item.severity === 'low') dropped.push({view: item.view, severity: 'low', kind: item.kind, title: String(item.title || '').slice(0, 80), source: item.source, why: 'low severity (never filed)'});
  return all.filter(item => item.severity !== 'low').filter(item => !seen.has(item.id) && seen.add(item.id));
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
    // A new deterministic truth check blocks only once it is a real open issue (seen twice, or confirmed), like an AI finding: one buggy check must not stop a release.
    if (finding.source === 'layout-check' && finding.kind !== 'wrong-result') return true;
    if (finding.kind === 'wrong-result') { const issue = matchExisting(finding, issues); return !!issue && (sightings(issue) >= SIGHTINGS_NEEDED || (issue.labels || []).some(item => (item.name || item) === CONFIRMED)); }   // deterministic and "severe" only for a sideways-scrolling page, a row hundreds of pixels tall, a broken image
    if (!BLOCKING_AI_KINDS.includes(finding.kind)) return false;
    const issue = matchExisting(finding, issues);
    return !!issue && (sightings(issue) >= SIGHTINGS_NEEDED || (issue.labels || []).some(item => (item.name || item) === CONFIRMED));
  });
}

// A suite that failed because the AI had no credit says nothing about the product. A suite that tests the spend-limit message on purpose is not read from its logs.
export const NO_CREDIT = /credit balance is too low|spend limit is reached|AI limit reached|usage limits?\b/i;
export const LIMIT_TESTED = ['activityfailures'];

const SOURCE_WORDS = {'layout-check': 'the layout check', 'suite-failure': 'a run of the suite (a step failed)', 'ai-review': 'the AI screenshot review', 'explorer': 'the AI explorer (an AI found it, a script proved it again without AI)', 'interaction-probe': 'the interaction probe (it pressed the control and recorded what happened)'};
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
  for (const line of [evidence.context, evidence.stepAge]) if (line) out.push(`> ${line}`);
  out.push(`> 🔗 First seen: ${runUrl}`, '', '### What was found', formatDetail(finding));
  if (finding.impact) out.push('', '### Why it matters', finding.impact);
  if (finding.workaround) out.push('', '### What the person has to do to get past it', finding.workaround);
  if (finding.suggestion) out.push('', '### Suggested', finding.suggestion);
  if (picture || rows.length || logs.length) out.push('', '### Evidence');
  if (picture) out.push(`![${view}](${picture})`);
  if (rows.length) out.push('', '<details><summary>App state when this was taken</summary>', '', ...rows.map(([name, value]) => `- **${name}:** ${value}`), '', '</details>');
  if (finding.also?.length) out.push('', '### Failed after it', ...finding.also.slice(0, 8).map(step => `- ${step}`), ...(finding.also.length > 8 ? [`- … and ${finding.also.length - 8} more`] : []), '', '<sub>Probably consequences of the first failure (later steps of the same suite).</sub>');
  for (const [name, text] of logs) out.push('', `<details><summary>${name} (last lines)</summary>`, '', fence(text), '', '</details>');
  if (suite && evidence.replay) {
    // How it was found (lib/replay.mjs): the run's type, path, window, place, theme and steps, the exact command, and the same facts as one hidden JSON line.
    out.push('', '### Reproduce', fence(replayCommand(evidence.replay), 'sh'), `The step that photographs \`${view}\` (\`snap(ctx, '${view}')\`) shows it.`,
      '', replayBlock(evidence.replay, {platform, withCommand: false}));
  } else if (suite) {
    out.push('', '### Reproduce', fence([`cd desktop/e2e`, `node suite.mjs ${suite}${evidence.seed ? `    # the fixed path` : ''}`, ...(evidence.seed ? [`E2E_SEED=${evidence.seed} node suite.mjs ${suite}    # this run's path`] : [])].join('\n'), 'sh'),
      `The step that photographs \`${view}\` (\`snap(ctx, '${view}')\`) shows it.`);
    if (evidence.seed) out.push('', `<details><summary>Variation of this run: seed ${evidence.seed}${evidence.window ? `, window ${evidence.window.join('x')}` : ''}</summary>`, '',
      ...(evidence.detail ? [`${evidence.detail}`, ''] : []), 'The seed shuffles the pages, the controls and the form data; the same seed replays the same path.', '', '</details>');
  }
  const where = [];
  if (evidence.codeFile) where.push(`- Code: \`${evidence.codeFile}\``);
  if (suite) where.push(`- The run's artifacts: \`e2e-artifacts-${suite}\` (\`ui-${view}.png\`, \`ui-${view}.json\`, the findings files)`);
  if (where.length) out.push('', '### Where to look', ...where);
  if (evidence.replay) out.push('', replayComment(evidence.replay));
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
// A finding from a Windows run that the Mac already told: an open Mac issue, or one a person rejected as not planned (4 Oct 2026: #239 / #202, #215 / #146 were the same finding filed twice).
// A Mac issue closed as fixed does not count: a Windows run that sees it again may be a real regression.
// At most this many NEW issues from the AI screenshot review in one run, the highest severity first (owner, 4 Oct 2026: "no need to invent trivial bugs"). A full run that finds more than
// this is more likely noisy than broken; the rest are dropped, and a real one shows again in the next run.
export const MAX_NEW_AI_PER_RUN = 3;
export function capNewAi(plan, max = MAX_NEW_AI_PER_RUN) {
  const fresh = plan.filter(item => !item.existing && !item.twin && item.finding.source === 'ai-review');
  const rank = item => ({high: 0, medium: 1, low: 2})[item.finding.severity] ?? 3;
  const keep = new Set([...fresh].sort((a, b) => rank(a) - rank(b)).slice(0, max));
  return plan.filter(item => !fresh.includes(item) || keep.has(item));
}
// What the filters cut this run, as a table the owner can read (4 Oct 2026: to tell whether the Finder is too restrictive).
export function droppedTable(dropped, max = 30) {
  if (!dropped.length) return '';
  const rows = dropped.slice(0, max).map(item => `| ${String(item.source || 'ai-review').replace(/\|/g, '/')} | ${String(item.view || '').replace(/\|/g, '/')} | ${String(item.severity || '?')} | ${String(item.title || '').replace(/\|/g, '/')} | ${String(item.why).replace(/\|/g, '/')} |`);
  return ['', `### Raised but not filed: ${dropped.length}`, 'What the filters cut (so a missing bug can be found here): low ones, no stated impact, over the per-run cap, matching a closed false positive.', '',
    '| Detector | Page | Severity | Finding | Why not filed |', '|---|---|---|---|---|', ...rows, ...(dropped.length > max ? [`| | | | … and ${dropped.length - max} more | |`] : [])].join('\n');
}
export function macTwin(finding, issues) {
  const mac = issues.filter(issue => ((issue.labels || []).map(item => item.name || item).find(name => name.startsWith('platform:')) || 'platform:mac') === 'platform:mac');
  const asMac = {...finding, id: String(finding.id).replace(/-win$/, '')};
  return matchExisting(asMac, mac) || matchExisting(asMac, mac.filter(issue => issue.stateReason === 'NOT_PLANNED'), 0.3, 'CLOSED') || null;
}
export function matchExisting(finding, issues, threshold = 0.3, state = 'OPEN') {
  const label = labelFor(finding.id);
  const named = issues.find(issue => issue.state === state && (issue.labels || []).some(item => (item.name || item) === label));
  if (named) return named;
  const text = `${finding.title} ${finding.detail}`;
  const kindOf = issue => /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  const best = (pool, floor) => pool.map(issue => ({issue, score: similar(text, `${(issue.title || '').replace(/^\[auto-ui\] [^:]+:/, '')} ${foundText(issue.body)}`)}))
    .filter(item => item.score >= floor).sort((a, b) => b.score - a.score)[0]?.issue || null;
  const open = issues.filter(issue => issue.state === state && kindOf(issue) === finding.kind);
  const same = best(open.filter(issue => viewOf(issue) === finding.view), threshold);
  if (same) return same;
  // The same bug seen from another variant of the page (activity-run-failed and activity-limit-paused, calendar and calendar-empty, jobs and jobs-narrow) was
  // filed twice (#103 and #105, #120 and #122, 4 Oct 2026). Within a page family and a kind, alike words are the same issue: those pairs scored 0.22 and 0.38,
  // distinct bugs of the same family at most 0.14.
  return best(open.filter(issue => viewOf(issue) !== finding.view && viewFamily(viewOf(issue)) === viewFamily(finding.view)), FAMILY_SIMILAR);
}
export const FAMILY_SIMILAR = 0.2;
export const viewFamily = view => String(view || '').replace(/-narrow$/, '').split('-')[0];

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
// REGRESSIONS and FLAKY steps (5 Oct 2026). A new finding that matches an issue a FIX closed (a commit said it fixes it, or the fixer's merge) is a regression:
// labelled, raised to P1 at least, so a fix that did not hold is never a quiet new P3. A failed step whose suite then passed on the SAME commit is flaky: the
// product did not change, so the test is the problem; labelled, ranked last, and listed as such (13 of 28 failed-step issues cleared on their own).
export const REGRESSION = 'regression', FLAKY = 'flaky';
const FIXED = /^(?:Closed: commit [0-9a-f]+ says it fixes this|Fixed by https?:\/\/)/;
export const closedByFix = issue => issue.state === 'CLOSED' && issue.stateReason !== 'NOT_PLANNED' && (issue.comments || []).some(comment => FIXED.test(comment.body || ''));
export const fixedBefore = (finding, issues) => matchExisting(finding, (issues || []).filter(closedByFix), 0.3, 'CLOSED');
// The commits a failed-step issue was seen failing on (its body and its "Seen again" comments).
export const failedCommits = issue => new Set([commitOf(issue.body), ...(issue.comments || []).filter(comment => /^Seen again\b/.test(comment.body || '')).map(comment => commitOf(comment.body))].filter(Boolean));
export const flakyOn = (issue, sha7) => !!sha7 && /·\s*test-failure\s*·/.test(issue.body || '') && failedCommits(issue).has(sha7);
export const regressionComment = (issue, runUrl) => `↩️ **Regression:** this looks like #${issue.number} ("${String(issue.title || '').replace(/^\[auto-ui\] /, '').slice(0, 80)}"), which a fix closed. The fix did not hold (${runUrl}).`;
export const flakyComment = (sha7, runUrl) => `🎲 **Flaky:** this step failed and then passed on the same commit \`${sha7}\` (${runUrl}). The product did not change, so the test is the problem: labelled \`flaky\`, ranked last, never offered to the fixer.`;

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
  const kind = /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  const seen = recentSightings(issue, now), points = score(issue, now);
  if (labels.includes(NOT_SEEN)) return 'P3';   // already clean in the latest run: waiting to close, never above the rest
  if (labels.includes(FLAKY)) return 'P3';   // the test, not the product
  const regressed = labels.includes(REGRESSION);
  if (severity === 'HIGH' && BLOCKING_KINDS.includes(kind) && (seen >= 2 || labels.includes(CONFIRMED))) return 'P0';
  return points >= 6 || regressed ? 'P1' : points >= 3 ? 'P2' : 'P3';   // a fix that did not hold is never a quiet P3
}

// What breaks the product outranks what is only rough: a wrong result > a dead or broken control > a missing spinner; a crashed test step is the harness, not the product.
// The score alone tied eleven of twelve rows on 3 Oct 2026 (a red status dot ranked like a missing spinner).
const KIND_WEIGHT = {functionality: 3, 'error-shown': 3, 'console-error': 3, 'dead-control': 2, 'expand-broken': 2, 'page-overflow': 2, 'tall-row': 2, 'broken-image': 2, 'no-loading-state': 1, 'test-failure': 0.5};
const CRITICAL_VIEWS = ['apply', 'applycv', 'strategy', 'activity', 'wizard'];   // the critical path: apply, strategy sync, run results, setup
const kindOf = issue => /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
const viewOf = issue => /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1] || '';
export const rankWeight = (issue, now = Date.now()) => score(issue, now) * (KIND_WEIGHT[kindOf(issue)] ?? 1) * (CRITICAL_VIEWS.includes(viewOf(issue)) ? 1.5 : 1);

// -> the open UI-loop issues, most important first: priority, then (already clean last), then weighted score, Mac before Windows (Windows never blocks a release), then the oldest.
// Parked ones (needs-human, wontfix-auto) are left out.
export function rankIssues(issues, now = Date.now()) {
  const has = (issue, name) => (issue.labels || []).some(item => (item.name || item) === name);
  // An issue that needs a person is open and the most relevant one to the owner, so it stays on the list, marked (4 Oct 2026: #265 was open with needs-human and #73 said "0 open"); only a false positive drops out.
  return issues.filter(issue => issue.state === 'OPEN' && !(issue.labels || []).some(item => (item.name || item) === FALSE_POSITIVE))
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
    if (!afterEpoch(issue)) continue;
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
// The fixer and the verdict pass over the same 30 days: pull requests opened, merged, closed unmerged, still open; verdicts real and false. With the detectors'
// scorecard this says whether the loop works on its own (4 Oct 2026). `prs`: [{state, createdAt}] of the label auto-ui-fix.
export function fixerCard(prs, issues, now = Date.now(), days = 30) {
  const recent = date => !date || now - Date.parse(date) <= days * 86400000;
  const pr = {opened: 0, merged: 0, closed: 0, open: 0};
  for (const item of prs || []) { if (!recent(item.createdAt)) continue; pr.opened++; pr[item.state === 'MERGED' ? 'merged' : item.state === 'CLOSED' ? 'closed' : 'open']++; }
  let real = 0, falsePositive = 0;
  for (const issue of issues || []) for (const comment of issue.comments || []) {
    if (!recent(comment.createdAt)) continue;
    if (/^(?:<!-- ui-loop-verdict:real -->|Judged real by the UI loop's verdict pass)/.test(comment.body || '')) real++;
    if (/^(?:<!-- ui-loop-verdict:false-positive -->|Closed by the UI loop as a false positive)/.test(comment.body || '')) falsePositive++;
  }
  return {pr, verdicts: {real, falsePositive}};
}
export const fixerLines = card => (card ? ['', `**Fixer and verdicts, last 30 days:** ${card.pr.opened} pull request(s) opened, ${card.pr.merged} merged, ${card.pr.closed} closed unmerged, ${card.pr.open} open · verdict pass: ${card.verdicts.real} real, ${card.verdicts.falsePositive} false positive(s).`] : []);
export function rankingBody(ranked, now = Date.now(), limit = 12, card = [], fixer = null) {
  const rows = ranked.slice(0, limit).map(({issue, priority, score: points}, index) => {
    const at = lastSeen(issue), days = at ? Math.floor((now - Date.parse(at)) / 86400000) : null;
    const age = days === null ? '' : days <= 0 ? 'today' : `${days} d ago${days >= 7 ? ' ⚠️' : ''}`;
    const platform = (issue.labels || []).some(item => (item.name || item) === 'platform:windows') ? 'Windows' : 'Mac';
    const clean = (issue.labels || []).some(item => (item.name || item) === NOT_SEEN) ? ' · clean last run' : '';
    const person = (issue.labels || []).some(item => (item.name || item) === NEEDS_HUMAN) ? '🙋 needs a person · ' : '';
    return `| ${index + 1} | **${priority}** | ${person}#${issue.number} ${String(issue.title || '').replace(/^\[auto-ui\] /, '').replace(/\|/g, '/').slice(0, 80)} | ${platform} | ${points} | ${[lastBuild(issue) ? `\`${lastBuild(issue)}\`` : '?', age].filter(Boolean).join(' · ')}${clean} |`;
  });
  const counts = PRIORITIES.map(band => `${band}: ${ranked.filter(item => item.priority === band).length}`).join(' · ');
  return ['**The open findings, most important first.** Re-ranked after every run.', '', `${counts} · ${ranked.length} open`, '',
    '| # | Priority | Finding | Platform | Score | Last build seen on |', '|---|---|---|---|---|---|', ...(rows.length ? rows : ['| | | nothing open | | | |']),
    '', '**P0** would keep a build from beta or stable · **P1** seen again and again, or high and confirmed · **P2** worth a look · **P3** seen once, or already clean in the latest run. Score = severity × sightings this week (× 2 when a person confirmed it). Within a priority: a wrong result before a dead control before a missing spinner (a crashed test step counts least), the critical path (apply, strategy, activity, setup) first, Mac before Windows. ⚠️ = not seen for 7 days or more. A finding closes after two clean runs of its page, or one when a commit says it fixes it.',
    ...scorecardLines(card), ...fixerLines(fixer), '', '<sub>Written by `desktop/e2e/triage.mjs`. Do not edit by hand.</sub>'].join('\n');
}

// Why an open issue is not ready for a fix ('' = ready): the fixer's rules, in the order they are checked. One place, so the pick and its summary agree.
export const NOT_READY = {
  parked: {why: 'Parked: a person must look (`needs-human`) or it was judged a false positive (`wontfix-auto`)', next: 'Remove the label once it is understood'},
  clean: {why: 'Clean in the latest run (`not-seen-latest`): waiting to close', next: 'Nothing: it closes by itself after another clean run'},
  'pr-open': {why: 'A fix pull request is already open', next: 'Review the pull request: merge it, or close it to let the fixer try again'},
  once: {why: `Seen fewer than ${SIGHTINGS_NEEDED} times this week, and not \`confirmed\` by a person`, next: 'Label it `confirmed` if it is real (`gh issue edit N --add-label confirmed`), or wait for the next sighting'},
  kind: {why: 'A kind the fixer does not take (a crashed test step, a console error)', next: 'Fix it by hand, or let its suite tell what failed'},
  unconfirmed: {why: 'A logic finding (a wrong result, a crash) not confirmed yet', next: 'The verdict pass or a person labels it confirmed; then the fixer takes it'},
};
// A failed suite step that is only a wait running out (a view that stayed hidden, an app that did not go quiet): the verdict pass reads its logs and says whether the product or the test is at fault.
export const TIMEOUT_FAILURE = /Unexpected token '<'|is not valid JSON|ECONNRESET|ETIMEDOUT|fetch failed|Timeout \d+\s?ms exceeded|waitForSelector|waiting for locator|still busy after|did not (?:appear|finish|go quiet) within/i;
export function notReadyReason(issue, {openBranches = [], now = Date.now()} = {}) {
  const labels = (issue.labels || []).map(label => label.name || label);
  const id = labels.find(name => name.startsWith('fp:'));
  if (issue.state !== 'OPEN' || !labels.includes(LABEL) || !id) return 'not-loop';
  if (labels.includes(NEEDS_HUMAN) || labels.includes(FALSE_POSITIVE)) return 'parked';
  if (labels.includes(NOT_SEEN)) return 'clean';
  if (openBranches.includes(`auto-fix/${id.slice(3)}`)) return 'pr-open';
  // A low finding is not worth an automatic fix (owner, 4 Oct 2026: polish and wording are low value, and most of the loop's pull requests were that); a person's `confirmed` still sends it.
  if (/\*\*LOW\*\*/.test(issue.body || '') && !labels.includes(CONFIRMED)) return 'low-value';
  if (recentSightings(issue, now) < SIGHTINGS_NEEDED && !labels.includes(CONFIRMED)) return 'once';
  const kind = /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  // A wrong result or a crash is fixed only once someone (the verdict pass or a person) said it is real: two sightings of a logic claim prove nothing.
  if (LOGIC_KINDS.includes(kind)) return labels.includes(CONFIRMED) ? '' : 'unconfirmed';
  return FIX_KINDS.includes(kind) ? '' : 'kind';
}

// Which open issue is ready for a fix: seen twice this week (or confirmed by a person), a kind a UI change can fix, not parked, no pull request open already.
// The most critical first (score), then the oldest.
export function pickCandidate(issues, {openBranches = [], now = Date.now()} = {}) {
  return pickCandidates(issues, {openBranches, now, max: 1})[0] || null;
}
// Several at once for the parallel fixer (4 Oct 2026: one fix per run, four runs a day, left confirmed bugs waiting for days). At most one per kind: two fixers
// on the same kind often chase one root cause and collide (#66 and #74 had one cause).
export function pickCandidates(issues, {openBranches = [], now = Date.now(), max = 4} = {}) {
  const ready = issues.filter(issue => notReadyReason(issue, {openBranches, now}) === '');
  ready.sort((a, b) => score(b, now) - score(a, now) || a.number - b.number);
  const kinds = new Set(), out = [];
  for (const issue of ready) {
    const kind = /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
    if (kinds.has(kind)) continue;
    kinds.add(kind); out.push(issue);
    if (out.length >= max) break;
  }
  return out;
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
    `- Kinds it fixes: ${FIX_KINDS.join(', ')}; and, once confirmed, ${LOGIC_KINDS.join(', ')} (the engine in src/ and the app's logic in desktop/lib/ too).`,
    '- The most critical ready one goes first: severity (high 3, medium 2, low 1) × sightings this week, doubled by `confirmed`; then the oldest.',
    '- At most 4 automatic fix pull requests wait for review at once; one fix per run.', '', '</details>', ''].join('\n');
}

// A change is only proposed if every file is allowed, there is a test among them, and nothing was deleted from the tests.
export function checkChange(files) {
  const bad = files.filter(file => !allowedPath(file));
  if (bad.length) return {ok: false, why: `edits outside the allowed folders: ${bad.join(', ')}`};
  // A fix comes with a test of its own side: Python with a tests/test_*.py, the window or the app's logic with a desktop/test/*.test.js.
  if (files.some(file => /^src\//.test(file)) && !files.some(file => /^tests\/test_/.test(file))) return {ok: false, why: 'an engine fix must come with a test in tests/'};
  if (files.some(file => /^desktop\/(renderer|lib)\//.test(file)) && !files.some(file => /^desktop\/test\//.test(file))) return {ok: false, why: 'a fix must come with a test'};
  if (!files.some(file => /^(desktop\/test|tests)\//.test(file))) return {ok: false, why: 'a fix must come with a test'};
  return {ok: true, why: ''};
}

// A finding that a person closed as a false positive (`wontfix-auto`) stays closed: the same fingerprint, or the same view and kind with alike words, however the AI words it now.
export const suppressedBy = (finding, issues) => matchExisting(finding, issues.filter(issue => (issue.labels || []).some(item => (item.name || item) === FALSE_POSITIVE)), 0.3, 'CLOSED');
