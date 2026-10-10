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
  const found = day(match?.first_seen || job.first_seen_at), scored = day(match?.scored);
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

// A saved posting as blocks the Description tab draws: "## x" a heading, "- x" a list item (src/sources/posting_text.py writes them, and the
// Markdown sections use the same marks), anything else a paragraph. [{kind: 'heading' | 'list' | 'text', text | items}].
// Text saved before 10 Oct 2026 has no line breaks at all (138 of 139 on the owner's Mac): it is cut into short paragraphs at sentence ends,
// by shape only (a full stop, then a capital or a digit), never by words.
const SENTENCE_END = /(?<=[.!?])\s+(?=[\p{Lu}\d])/u;
export function paragraphize(text, size = 380) {
  const whole = String(text || '').trim();
  if (whole.includes('\n') || whole.length < 500) return whole;
  const paragraphs = [];
  let current = '';
  for (const sentence of whole.split(SENTENCE_END)) {
    if (current && current.length + sentence.length > size) { paragraphs.push(current); current = sentence; }
    else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}

export function postingBlocks(text) {
  const blocks = [];
  let list = null;
  for (const raw of paragraphize(text).split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) { blocks.push({kind: 'heading', text: plain(heading[1])}); list = null; continue; }
    const item = /^[-*•]\s+(.*)$/.exec(line);
    if (item) { if (!list) blocks.push(list = {kind: 'list', items: []}); list.items.push(plain(item[1])); continue; }
    list = null;
    blocks.push({kind: 'text', text: plain(line)});
  }
  return blocks;
}

// The Description tab's facts (the owner's mock): who, when it was posted, when the search found it, and the saved copy. [{key, label, value, note}].
const SOURCE_KIND = {'employer feed': 'careers page', 'job board': 'job board', you: 'added by you'};
export function postingFacts(job = {}, found = {}, text = '') {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return [{key: 'employer', label: 'Employer', value: job.company || found.company || 'Not stated', note: SOURCE_KIND[found.source_kind] || found.source || ''},
    {key: 'posted', label: 'Posted', value: day(found.posted_at) || 'Not stated', note: ''},
    {key: 'found', label: 'First found', value: day(found.first_seen_at || job.first_seen_at) || 'Not stated', note: ''},
    {key: 'saved', label: 'Saved posting', value: text ? 'Saved' : 'None', note: text ? `${words} words` : ''}];
}
export const postingSource = (found = {}) => `Job description from ${SOURCE_KIND[found.source_kind] || found.source || 'the search'}${found.source && SOURCE_KIND[found.source_kind] ? ` (${found.source})` : ''}`;

// The Messages tab: what was communicated about the job. Emails are the job's Gmail events (src/ai/mail_record.py: the subject and sender in `changes`, the
// message id in `source_id`); notes are what you logged or a recruiter wrote (the 📥 sections). A Gmail link is the one the app always builds
// (src/ai/mail_record.py); an id from a calendar invite, a paste or a chat has none.
const NOT_EMAIL = /^(cal:|paste:|chat:)/;
export const gmailUrl = id => (id && !NOT_EMAIL.test(String(id)) ? `https://mail.google.com/mail/u/0/#all/${id}` : '');
const changesOf = event => {
  const changes = event?.changes;
  if (changes && typeof changes === 'object') return changes;
  try { return JSON.parse(changes || '{}') || {}; } catch { return {}; }
};
export function messagesOf(parts = {}, events = []) {
  const emails = (events || []).filter(event => event?.source === 'Gmail' && gmailUrl(event.source_id))
    .sort((a, b) => String(b.at || b.created_at || '').localeCompare(String(a.at || a.created_at || '')))
    .map(event => {
      const changes = changesOf(event);
      return {key: String(event.id || event.source_id), kind: 'email', title: plain(changes.subject || event.kind || 'Email'), outcome: String(event.kind || ''),
        when: day(event.at || event.created_at), from: plain(changes.from || ''), text: plain(event.note || ''), url: gmailUrl(event.source_id)};
    });
  const notes = ((parts.groups || {}).messages || []).map((each, n) => ({key: `note${n}`, kind: 'note', title: each.title || 'Message', lines: each.lines}));
  return {emails, notes, counts: {all: emails.length + notes.length, email: emails.length, note: notes.length}};
}

// The Timeline tab (board 08): what happened and when, newest first, one short entry each: the job's events (src/stores/base.py EVENT_FIELDS), then
// "Job discovered" from when the search first found it. Each entry says which kinds of event it is (the filter), where it came from, and where its
// detail is (the email in Messages, the snapshot in Application, the interviews). [{key, at, when, time, kind, title, source, text, kinds, link}].
const APPLICATION_KINDS = new Set(['Applied', 'Confirmation received', 'Offer', 'Rejected', 'Withdrawn']);
const clock = at => {
  const text = String(at || '');
  if (!/T\d\d:\d\d/.test(text)) return '';
  const when = new Date(text);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});
};
export function timelineOf(events = [], job = {}, match = null, parts = {}) {
  const items = (events || []).filter(event => event?.kind).map(event => {
    const email = event.source === 'Gmail' && !!gmailUrl(event.source_id);
    const changes = changesOf(event);
    const interview = event.kind === 'Interview scheduled' || !!event.interview_at;
    const kinds = [...(APPLICATION_KINDS.has(event.kind) ? ['application'] : []), ...(email ? ['message'] : []), ...(interview ? ['interview'] : [])];
    const link = interview ? 'interviews' : email ? 'messages' : event.kind === 'Applied' && parts.submitted ? 'snapshot' : null;
    return {key: String(event.id || `${event.kind}-${event.at}`), at: String(event.at || event.created_at || ''), when: day(event.at || event.created_at),
      time: clock(event.at), kind: String(event.kind), title: plain(changes.subject && email ? `${event.kind}: ${changes.subject}` : event.kind),
      source: email ? `From ${plain(changes.from || 'an email')} (Gmail)` : event.source ? `Source: ${event.source}` : '', text: plain(event.note || ''), kinds, link};
  }).sort((a, b) => b.at.localeCompare(a.at));
  const found = match?.first_seen || job.first_seen_at;
  if (found) items.push({key: 'discovered', at: String(found), when: day(found), time: clock(found), kind: 'Job discovered', title: 'Job discovered', source: '', text: 'Found by the search and added to your job list.', kinds: ['application'], link: null});
  return items;
}

// The Interviews tab (board 05): the interviews of the job: the upcoming ones from its events (an invitation by email and the calendar entry for the
// same time are one) and the recorded or practised ones from the interview store, newest first. A slot reads "Tue 14 Oct · 10:00".
const slot = at => {
  const text = String(at || '');
  const when = new Date(text);
  if (!text || Number.isNaN(when.getTime())) return '';
  const date = when.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'});
  return /T\d\d:\d\d/.test(text) ? `${date} · ${when.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})}` : date;
};
const OVERALL = {positive: ['Positive', 'good'], mixed: ['Mixed', 'warn'], negative: ['Needs work', 'bad']};
export function interviewsOf(page = {}, now = Date.now()) {
  const planned = new Map();
  for (const event of page.events || []) {
    const at = String(event?.interview_at || '');
    if (!at || Number.isNaN(new Date(at).getTime())) continue;
    const key = at.slice(0, 16);
    const changes = changesOf(event);
    const found = planned.get(key) || {key: `slot-${key}`, kind: 'slot', at, title: 'Interview', note: '', source: ''};
    if (event.source === 'Gmail') { found.title = plain(changes.subject || found.title); found.note = plain(event.note || found.note); found.source = `From ${plain(changes.from || 'an email')}`; }
    else if (!found.note) found.note = plain(event.note || '');
    planned.set(key, found);
  }
  if (!planned.size && page.app?.next_interview) planned.set('next', {key: 'slot-next', kind: 'slot', at: String(page.app.next_interview), title: 'Interview', note: '', source: ''});
  const slots = [...planned.values()].map(item => ({...item, when: slot(item.at), upcoming: new Date(item.at).getTime() >= now,
    status: new Date(item.at).getTime() >= now ? 'Scheduled' : 'Past'})).sort((a, b) => b.at.localeCompare(a.at));
  const records = (page.interviews || []).filter(record => record?.id).map(record => ({key: String(record.id), kind: 'record', title: plain(record.title || 'Interview'), round: plain(record.round || ''),
    when: slot(record.at || record.created_at), at: String(record.at || record.created_at || ''), overall: OVERALL[record.overall] || null, nextStep: plain(record.next_step || ''),
    input: String(record.input || ''), transcript: readablePart(String(record.transcript || '')).trim(), hasReview: !!String(record.review || '').trim()}))
    .sort((a, b) => b.at.localeCompare(a.at));
  return {upcoming: slots.filter(item => item.upcoming), past: slots.filter(item => !item.upcoming), records};
}

// The Review tab's choice (board 06): the rejection's review and each interview's, with what each says. [{key, label, markdown}]; the markdown is a
// section (the rejection) or the interview record's review.
export function reviewsOf(page = {}) {
  const rejection = (page.sections || {})[SECTIONS.review];
  const found = rejection ? [{key: 'rejection', label: 'Rejection review', markdown: rejection}] : [];
  return [...found, ...(page.interviews || []).filter(record => record?.id && String(record.review || '').trim())
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).map(record => ({key: `iv-${record.id}`, label: `${plain(record.title || 'Interview')} review`, markdown: String(record.review)}))];
}

// The rejection, as its email said it (board 06): when and from whom, and what the employer stated: the latest "Rejected" event's note. "" when
// the email gave no reason, which the Review tab then says. null when there is no rejection event. Never the AI's words: those are the review.
export function rejectionOf(page = {}) {
  const event = [...(page.events || [])].filter(each => each?.kind === 'Rejected').sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  if (!event) return null;
  return {when: day(event.at || event.created_at), from: plain(changesOf(event).from || ''), statement: plain(event.note || '')};
}

// A posting the last full search no longer listed: the match row's status "Not seen" (src/stores/matches_sync.py: "not proof the posting closed").
export const notSeen = page => page?.match?.status === 'Not seen';

// The emails waiting on this job: Focus's "Which job is this email about?" items (kind which_job) whose suggested job is this one. [{key, eventId, subject, note, item}].
// `item` is the Focus item itself, as pages/reassign.js whichJob takes it.
export function waitingEmails(items = [], url = '') {
  return (items || []).filter(item => item?.kind === 'which_job' && item.event_id && url && item.suggested_url === url)
    .map(item => ({key: String(item.event_id), eventId: String(item.event_id), subject: plain(item.title || 'An email'), note: plain(item.note || item.detail || ''), item}));
}

// The page's content: {tabs: TABS (every job has all eight), kit, groups: {match, prep, review, record, messages, description}, history, shots,
// documents, has: {tab key → it has content, for its empty state}}.
export function pageParts({sections = {}, kit = null, events = [], files = [], match = null, app = null, interviews = []} = {}) {
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
      || groups.prep.length > 0 || submittedOf(sections, app) !== null,
    interviews: !!app?.next_interview || interviews.length > 0, review: groups.review.length > 0 || interviews.some(record => String(record?.review || '').trim()), messages: messages.length > 0 || shots.length > 0, timeline: history.length > 0};
  // The posting as text (the section, or the record's frozen copy): the Description tab draws it as blocks, else asks for the search's saved copy.
  const descriptionText = readablePart(String(sections[SECTIONS.description] || jsonOf(sections[SECTIONS.record])?.job?.description || '')).trim();
  return {tabs: TABS, kit: kitView, groups, history, shots, documents, submitted: submittedOf(sections, app), descriptionText, has};
}

// What was actually sent, from the application's frozen record (its JSON, src/notion/ledger_record.py build_fields): {facts, note, answers, letter}
// or null when nothing was captured. It never changes when the kit or the CV are edited afterwards: the record is written once at submission.
const HOW = {Form: 'Answers read from the form just before Submit.', 'Kit draft': 'Answers are the kit drafts; edits made in the form before Submit are unknown.',
  None: 'No answers were captured.'};
export function submittedOf(sections = {}, app = null) {
  const record = jsonOf(sections[SECTIONS.record]);
  if (!record || !(record.recorded_at || record.job || record.answers)) return null;   // an empty or foreign JSON is not a snapshot
  const site = record.job?.ats ? record.job.ats.charAt(0).toUpperCase() + record.job.ats.slice(1) : '';
  const facts = [['Recorded', day(record.recorded_at)], ['Site', site], ['Channel', app?.channel],
    ['Via', app?.via], ['CV version', record.cv], ['Kit variant', record.variant], ['Agent', record.run?.agent]].filter(([, value]) => value);
  const answers = (Array.isArray(record.answers) ? record.answers : []).filter(item => item?.question)
    .map(item => ({question: String(item.question), answer: String(item.answer ?? ''), edited: item.draft != null && item.draft !== item.answer}));
  return {facts, note: HOW[record.answers_captured] || '', answers, letter: String(record.cover_letter || '').trim(),
    when: day(record.job?.applied_on || record.recorded_at)};
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
