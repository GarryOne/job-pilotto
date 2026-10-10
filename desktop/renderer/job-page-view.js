// A job's page in the app (Jobs → a row → the right-side drawer): what the job's Notion page shows, read from the store, so it shows for
// every store (the data on this Mac too). Pure: the drawer's eight tabs, and each tab's parts as text (never HTML). Drawn by
// pages/job-panel.js and job-drawer/; guarded by test/job-page-view.test.js. The sections are the engine's own headings (src/ai/kit.py KIT_HEADING,
// prep.py HEADING, rejection.py HEADING, notion/ledger_record.py RECORD_HEADING, inbox_notion.py DESCRIPTION_HEADING, opportunity.py HEADING).
import {shortDay} from './date.js';
export const SECTIONS = {
  kit: '📝 Application kit', prep: '🎤 Interview prep', review: '🔎 Why it was rejected', record: '🗂 Application record',
  description: '🧾 Job description', recruiter: '🤝 Recruiter message',
};
// Logged messages ("📥 29 Sep · what it said"): every section named with 📥, after the recruiter's own message.
const isMessages = name => name === SECTIONS.recruiter || /^📥/.test(name);

// [key, label] in the owner's order (10 Oct 2026): fixed for every job, so a tab is where it was last time; a tab with nothing yet says so
// (job-drawer/tab-*.js). Kit and Prep became Application, Record its Submitted part, History the Timeline.
export const TABS = [['overview', 'Overview'], ['match', 'Match'], ['description', 'Description'], ['application', 'Application'],
  ['interviews', 'Interviews'], ['review', 'Review'], ['messages', 'Messages'], ['timeline', 'Timeline']];
// The tabs' old names (a kit chip, a rejection chip, the prep card) → where that content lives now.
export const TAB_ALIASES = {kit: 'application', prep: 'application', record: 'application', history: 'timeline'};
export const tabKey = tab => (TABS.some(([key]) => key === tab) ? tab : TAB_ALIASES[tab] || 'overview');

// A line of the store's Markdown as plain words: links keep their label, marks and escapes go (notion_blocks.py writes them).
export function plain(line) {
  return String(line || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g, (_, a, b, c) => a ?? b ?? c)
    .replace(/\\(.)/g, '$1')
    .replace(/^(>\s*)+/, '')
    .replace(/^\[![^\]]*\]\s*/, '')   // a callout block's icon, as the codec writes it: > [!🛠] …
    .replace(/^▸\s*/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim();
}

// One line of a section: its words, bold when the whole line is (a question, "Evidence"), a to-do's state, a quote.
const LIST = /^\s*(?:[-*•]|\d+[.)])\s+/;
export function lineOf(raw) {
  const text = String(raw || '').replace(LIST, '').trim();
  const todo = /^\[([ xX])\]\s+/.exec(text);
  return {text: plain(text), strong: /^\*\*[^*]+\*\*(\s*[❓✏️].*)?$/u.test(text), todo: todo ? todo[1] !== ' ' : null, quote: /^>/.test(text)};
}

// The readable part: code fences (the machine-readable JSON) and their "Machine-readable …" heading are for programs.
export function readablePart(markdown) {
  return String(markdown || '').replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```[ \t]*$/gm, '').replace(/^\s*#{1,4}\s+Machine-readable.*$/gim, '');
}

// [{title, lines: [line | {fold, lines}]}] of a section (lib/store notion_blocks.py's Markdown): its headings start groups; a line whose
// children follow it indented is a Notion toggle ("📧 Full message", a logged entry) and folds them; every line plain words.
export function groupsOf(markdown, first = '') {
  const groups = [];
  let group = null, fold = null;
  const lines = readablePart(markdown).split('\n');
  const into = () => (group ||= (groups.push({title: first, lines: []}), groups.at(-1)));
  lines.forEach((raw, i) => {
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(raw);
    if (heading) { group = {title: plain(heading[1]), lines: []}; groups.push(group); fold = null; return; }
    if (!raw.trim() || raw.trim() === '---') return;
    const indented = /^\s{2,}\S/.test(raw);
    if (fold && indented) { const line = lineOf(raw); if (line.text) fold.lines.push(line); return; }
    fold = null;
    if (!indented && !LIST.test(raw) && /^\s{2,}\S/.test(lines[i + 1] || '')) { fold = {fold: plain(raw), lines: []}; into().lines.push(fold); return; }
    const line = lineOf(raw);
    if (line.text) into().lines.push(line);
  });
  return groups.filter(each => each.lines.length);
}

// The section's last ```json fence as an object (the record's own JSON: its job snapshot holds the posting), or null.
export function jsonOf(markdown) {
  const fences = [...String(markdown || '').matchAll(/^\s*```json[ \t]*\n([\s\S]*?)\n\s*```[ \t]*$/gm)];
  try { const value = fences.length ? JSON.parse(fences.at(-1)[1]) : null; return value && typeof value === 'object' ? value : null; } catch { return null; }
}

// The kit: from its JSON when the section has one (the engine's own record, lib/store/extension-store.js kitOf in the main process),
// else its readable text. {check, lead, letter, answers: [{question, answer, review}], ineligible} or {groups}.
export function kitParts(kit, markdown) {
  if (!kit) return {groups: groupsOf(markdown)};
  // Its first line says how it was made: "Form questions read from Greenhouse" or "No form read" (src/ai/kit.py).
  const lead = groupsOf(markdown)[0];
  const intro = lead && !lead.title ? lead.lines.map(line => line.text ?? line.fold).join(' ') : '';
  const list = value => (Array.isArray(value) ? value : []).map(String).filter(Boolean);
  return {
    intro,
    ineligible: kit.eligible === false ? String(kit.eligibility_note || 'Not eligible') : '',
    check: list(kit.check_before_sending), lead: list(kit.highlights), letter: String(kit.cover_letter || '').trim(),
    answers: (Array.isArray(kit.answers) ? kit.answers : []).filter(item => item?.question)
      .map(item => ({question: String(item.question), answer: String(item.answer ?? ''), review: !!item.needs_review})),
  };
}

const day = at => shortDay(at) || String(at || '').slice(0, 10);   // the screens' one format (date.js)

// events.list(app_id) → the timeline, newest first: {when, kind, note}.
export function historyItems(events = []) {
  return [...(events || [])].filter(event => event?.kind)
    .sort((a, b) => String(b.at || b.created_at || '').localeCompare(String(a.at || a.created_at || '')))
    .map(event => ({when: day(event.at || event.created_at), kind: String(event.kind), note: plain(event.note || '')}));
}

// The search's facts about the job (its 🎯 Job Matches row on every store, src/stores/matches_sync.py facts): what a Notion user reads in
// those columns. Strengths and gaps are on the row's fit ring (jobs-fit.js), not repeated here. [] when the job has no match.
// [label, value] of what the search read from the posting, only what it has (the Overview's key facts; the Match tab's "About the job").
export function factPairs(match = null) {
  if (!match) return [];
  const languages = (Array.isArray(match.languages) ? match.languages : []).map(name => name.replace(/ \+$/, ' (a plus)')).join(', ');
  const pairs = [['Posted', day(match.posted)], ['Deadline', day(match.deadline)], ['Seniority', match.seniority], ['Role family', match.role_family],
    ['Contract', match.contract], ['Work mode', match.work_mode], ['Remote scope', match.remote_scope], ['Workload', match.workload],
    ['On call', match.on_call], ['Visa sponsorship', match.visa], ['Languages', languages], ['Technologies', match.technologies],
    ['Salary', match.salary]].filter(([, value]) => value);
  return match.recruiter === true ? [...pairs, ['Posted by', 'a recruiter']] : pairs;
}

// The search's facts about the job (its 🎯 Job Matches row on every store, src/stores/matches_sync.py facts): what a Notion user reads in
// those columns. Strengths and gaps are on the row's fit ring (jobs-fit.js), not repeated here. [] when the job has no match.
export function matchGroups(match = null) {
  if (!match) return [];
  const score = [match.fit != null && match.fit !== '' ? `🎯 ${match.fit}` : '', match.tier, match.confidence && `confidence ${match.confidence}`]
    .filter(Boolean).join(' · ');
  const scored = match.scored ? `Scored ${day(match.scored)}${match.scoring_method === 'Previous' ? ' (from your earlier Profile)' : ''}` : '';
  const facts = factPairs(match).map(([label, value]) => (label === 'Posted by' ? `Posted by ${value}` : `${label} · ${value}`));
  const groups = [];
  if (score || scored) groups.push({title: 'Fit', lines: [score, scored].filter(Boolean)});
  if (facts.length) groups.push({title: 'About the job', lines: facts});
  return groups;
}

// The job's match as the tabs read it: the list row's own fields first (fresher), the store's Job Matches row for what it lacks (a job opened
// from the calendar or a run has no fit_detail on it). null when the job was never scored.
export function matchView(job = {}, page = null) {
  const stored = page?.match || {};
  const fit = job.fit ?? stored.fit;
  if (fit == null || fit === '') return null;
  return {...stored, ...Object.fromEntries(Object.entries(job).filter(([, value]) => value != null && value !== '')), fit,
    fit_detail: job.fit_detail || stored.fit_detail || null};
}

// The Overview's "At a glance" tiles (the owner's mock, 10 Oct 2026): six facts a person weighs first, each with a note, "Not stated" when the posting
// does not say. [{key, label, value, note, known}]. Words from the job's match (factPairs' own values).
export function glanceTiles(match = null) {
  const m = match || {};
  const languages = (Array.isArray(m.languages) ? m.languages : []).map(name => name.replace(/ \+$/, ' (a plus)')).join('; ');
  const tile = (key, label, value, note = '') => ({key, label, value: value || 'Not stated', note: value ? note : '', known: !!value});
  const mode = m.work_mode;
  return [tile('salary', 'Salary', m.salary, 'From the posting'),
    tile('mode', 'Work mode', mode, m.remote_scope || (mode === 'Hybrid' ? 'Office days not stated' : '')),
    tile('contract', 'Contract', m.contract, m.workload ? `Workload ${m.workload}` : ''),
    tile('seniority', 'Seniority', m.seniority, m.role_family ? `Role family: ${m.role_family}` : ''),
    tile('languages', 'Languages', languages),
    tile('posted', 'Posted', day(m.posted), m.deadline ? `Deadline ${day(m.deadline)}` : '')];
}

// "First found 9 Oct · Scored 9 Oct" under the tiles.
export function foundLine(job = {}, match = null) {
  const found = day(job.first_seen_at || match?.first_seen), scored = day(match?.scored);
  return [found && `First found ${found}`, scored && `Scored ${scored}`].filter(Boolean).join(' · ');
}

// What the role involves, one short line each (the extractor's responsibilities, written a line each), and the technologies as chips.
export const lines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
export const technologiesOf = match => String(match?.technologies || '').split(/;\s*/).map(name => name.trim()).filter(Boolean);
// What is worth clarifying: what the score's "What to check" holds.
export const clarifyOf = match => String(match?.fit_detail?.gaps || '').split(/;\s+/).map(item => item.trim()).filter(Boolean);
// "Team size: 8 · Visa/permit: not needed": what the calls said (Applications Call facts).
export const callFacts = app => plain(app?.call_facts || '');
// The next interview, for the header's bar: {when} or null.
export const nextInterview = app => (app?.next_interview ? {when: day(app.next_interview)} : null);

// The page's content: {tabs: TABS (every job has all eight), kit, groups: {match, prep, review, record, messages, description}, history, shots,
// documents, has: {tab key → it has content, for its empty state}}.
export function pageParts({sections = {}, kit = null, events = [], files = [], match = null} = {}) {
  const named = Object.entries(sections || {});
  const messages = named.filter(([name]) => isMessages(name))
    .flatMap(([name, markdown]) => groupsOf(markdown, plain(name)));
  const groups = {
    match: matchGroups(match),
    prep: groupsOf(sections[SECTIONS.prep]), review: groupsOf(sections[SECTIONS.review]),   // the tab names them: no heading of their own
    record: groupsOf(sections[SECTIONS.record]), messages,
    // The posting as saved on the job, else as frozen in its application record (its job snapshot, src/notion/ledger_record.py).
    description: groupsOf(sections[SECTIONS.description] || jsonOf(sections[SECTIONS.record])?.job?.description || ''),
  };
  const kitView = sections[SECTIONS.kit] || kit ? kitParts(kit, sections[SECTIONS.kit]) : null;
  const history = historyItems(events);
  // The job's images (a logged message's screenshots) belong with its messages; other files (a tailored CV) are not shown here.
  const shots = (files || []).filter(file => /^image\//.test(file?.type || ''));
  // The other files the app keeps on the job (a tailored CV, lib/store/files.js attachToJob): listed with the kit, to open or save.
  const documents = (files || []).filter(file => file && !/^image\//.test(file.type || ''));
  const has = {
    overview: groups.match.length > 0, match: groups.match.length > 0, description: groups.description.length > 0,
    application: (!!kitView && !!(kitView.groups?.length || kitView.letter || kitView.answers?.length || kitView.check?.length)) || documents.length > 0
      || groups.prep.length > 0 || groups.record.length > 0,
    interviews: false, review: groups.review.length > 0, messages: messages.length > 0 || shots.length > 0, timeline: history.length > 0};
  return {tabs: TABS, kit: kitView, groups, history, shots, documents, has};
}

// "Next interview 14 Oct 2026 · prep 13 Oct 2026" and the call's facts (Applications Next interview, Interview prep, Call facts).
export function interviewFacts(app = null) {
  if (!app) return '';
  return [app.next_interview && `Next interview ${day(app.next_interview)}`, app.interview_prep && `prep ${day(app.interview_prep)}`,
    app.call_facts && `From the calls: ${plain(app.call_facts)}`].filter(Boolean).join(' · ');
}

// "applied 1 Oct" (the drawer header's chip row; the place and the score are already in the header).
export function appliedLine(job = {}, app = null) {
  const applied = app?.applied_on || job.applied_on;
  return applied ? `applied ${day(applied)}` : '';
}

// "Applied 1 Oct 2026 · Zurich · 🎯 82" (the mockup's line under the title).
export function headerFacts(job = {}, app = null) {
  const stage = app?.stage || job.stage || '';
  const applied = app?.applied_on || job.applied_on;
  return [applied ? `${stage === 'Applied' || !stage ? 'Applied' : stage} · applied ${day(applied)}` : stage,
    job.location || app?.location, job.fit != null ? `🎯 ${job.fit}` : ''].filter(Boolean).join(' · ');
}

// Everything copyable in the kit's answers, for "Copy all": "Question\nAnswer" pairs.
export const allAnswers = answers => answers.map(item => `${item.question}\n${item.answer}`).join('\n\n');
