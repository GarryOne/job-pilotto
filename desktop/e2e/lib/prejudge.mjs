// Judge BEFORE filing (5 Oct 2026): the verdict pass used to read a finding only after its issue was open, so every false positive still cost an issue, a
// notification and a place in the statistics. Now the run's NEW findings (at most PREJUDGE_MAX) are judged first, in one Claude session: `false-positive` and
// `harness` are never filed (listed in the run's summary and remembered in the pinned noise register, so the same noise is not judged again), `real` is filed
// already `confirmed`, `needs-human` is filed parked. A finding over the cap, or a run without AI, is filed as before and judged later (ui-verdict.yml). Pure.
import {checkEvidence, parse} from './verdict-comment.mjs';
import {FALSE_POSITIVE, labelFor, TIMEOUT_FAILURE} from './triage.mjs';

export const PREJUDGE_MAX = 3;   // per run; four runs a day = at most 12 judgements a day
export const NOISE_WORDS = ['false-positive', 'harness'];
export const REGISTER_LABEL = 'noise-register';
export const REGISTER_KEEP = 300;

// Which new findings are worth a judgement: a detector's one-off reading (the AI review, the layout and truth checks, the probe), and a failed step that only ran out of
// time. A plain failed step is the suite's own judgement, so it is filed as it is.
export const judgeable = finding => finding.source !== 'suite-failure' || TIMEOUT_FAILURE.test(finding.detail || '');
// The most severe first, so the cap never leaves a high finding unjudged for a medium one.
export function pendingOf(findings, max = PREJUDGE_MAX) {
  const rank = {high: 0, medium: 1, low: 2};
  return findings.filter(judgeable).sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)).slice(0, max)
    .map(item => ({id: item.id, view: item.view, kind: item.kind, severity: item.severity, source: item.source, title: item.title, detail: item.detail,
      impact: item.impact || '', workaround: item.workaround || '', screenshot: item.screenshot || ''}));
}

// The one prompt for the session: the verdict pass's own rules, then every finding with the picture to open, and the answer's shape.
export function prejudgePrompt(pending, base) {
  const blocks = pending.map(item => [`## ${item.id}`, `Detector: ${item.source} · kind: ${item.kind} · severity: ${item.severity} · page: ${item.view}`, `Title: ${item.title}`, `What was found: ${item.detail}`,
    ...(item.impact ? [`Why it matters (the detector's words): ${item.impact}`] : []), ...(item.screenshot ? [`Screenshot: ${item.screenshot} (open it with Read)`] : ['Screenshot: none'])].join('\n'));
  return `${base}\n\n---\nTHIS RUN: you judge ${pending.length} NEW finding(s) BEFORE any issue is opened, in one go (about 8 turns each). Each is a section below; its screenshot is a file to Read.\n` +
    'Write ONE file, .heal/verdicts.md: for every finding a section `## <its id>` (exactly the id below), then the verdict word on its own line, then `Why:` and, for needs-human, `Check:`, as described above.\n\n' + blocks.join('\n\n');
}

// .heal/verdicts.md -> {id: raw verdict text}; a `real` whose cited code does not exist becomes needs-human (checkEvidence). Unknown ids are ignored.
export function parseVerdicts(text, ids, lines = () => 1) {
  const out = {};
  for (const part of String(text || '').split(/^## /m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    const id = head.trim();
    if (!ids.includes(id)) continue;
    let raw = rest.join('\n').trim();
    const {word, note} = checkEvidence(raw, lines);
    if (note) raw = `${word}\n${raw.split('\n').slice(1).join('\n').trim()}\nCheck: ${note}`;
    out[id] = raw;
  }
  return out;
}
export const wordOf = raw => { const {word} = parse(raw); return ['real', 'false-positive', 'harness', 'needs-human'].includes(word) ? word : 'needs-human'; };

// The noise register: one pinned issue whose body keeps what was judged noise before filing, as JSON, so the next run drops the same finding without a judgement.
const BLOCK = /```json\n([\s\S]*?)\n```/;
export function registerEntries(body) { try { const list = JSON.parse(BLOCK.exec(String(body || ''))?.[1] || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
export function registerBody(entries) {
  const kept = entries.slice(-REGISTER_KEEP);
  const rows = kept.slice(-15).reverse().map(item => `| ${item.date} | ${item.view} | ${String(item.title).replace(/\|/g, '/').slice(0, 70)} | ${item.word} | ${String(item.why).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 140)} |`);
  return ['**Findings judged noise BEFORE an issue was opened** (the verdict pass, `lib/prejudge.mjs`). The next runs drop the same finding without a judgement. To file one after all, delete its entry below.', '',
    `${kept.length} remembered · the latest ${rows.length}:`, '', '| Date | Page | Finding | Verdict | Why |', '|---|---|---|---|---|', ...rows, '',
    '<details><summary>The register (read by the loop: keep it valid JSON)</summary>', '', '```json', JSON.stringify(kept, null, 0), '```', '', '</details>'].join('\n');
}
// Register entries as closed false-positive issues, so the loop's own matching (same page and kind, alike words) suppresses them like a person's rejection.
export const asIssues = entries => entries.map(item => ({state: 'CLOSED', stateReason: 'NOT_PLANNED', title: `[auto-ui] ${item.view}: ${item.title}`,
  body: `**MEDIUM** · ${item.kind} · found by the register\n\n### What was found\n${item.detail || ''}\n`, labels: [{name: FALSE_POSITIVE}, {name: labelFor(item.id)}]}));
export const entryOf = (finding, raw, date) => ({id: finding.id, view: finding.view, kind: finding.kind, title: String(finding.title).slice(0, 120), detail: String(finding.detail || '').slice(0, 300),
  word: wordOf(raw), why: parse(raw).why.slice(0, 300), date});
