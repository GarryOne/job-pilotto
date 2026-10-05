// A Gmail check's message as the parts of it the owner reads. src/ai/mail.py writes the lines (prep_message and the
// notes around it); nothing here re-words them, it only puts each one where it belongs.
//
// The shapes a check really produces (30 Sep 2026, from Notion):
//   🗓 Tomorrow 08:30 — Huxley — Principal SRE / <what> / <where> / With: … / 🏋️ Answered weakly in past interviews /
//   • topic / 📝 <next step> / Recording? … / Application in Notion (url)      → the interview card
//   🎤 How did … go? Send the transcript …                                    → a note
//   📧 Job emails and calendar / ❓ … / 🗓 …                                    → notes
//   📧 Gmail checked: no new job emails.                                      → the status line alone
const SCHEDULED = /^🗓\s+(.+?)\s+—\s+(.+?)\s+—\s+(.+)$/;
const WEAK = /^(?:🏋️\s*)?Answered weakly in past interviews/i;
// Since the plain layout (src/tgcard.py; mail.prep_message()): "🗓 Interview tomorrow", then "Huxley · Principal SRE · Interview",
// "Tomorrow · 08:30", the event, the link, "With: …", the weak topics, "Next step" and its text on the next line.
const PREP_TITLE = /^🗓\s+Interview (?:today|tomorrow)\s*$/i;
const PREP_HEAD = /^(.+?)\s+·\s+(.+?)\s+·\s+Interview\s*$/;
const PREP_WHEN = /^(Today|Tomorrow)\s+·\s+(\d{1,2}:\d{2})\s*$/;
const NEXT_HEAD = /^Next step\s*$/;
const TOPIC = /^[•·]\s*(.+)$/;
const NEXT_STEP = /^📝\s*(.+)$/;
const CONSENT = /^Recording\?/i;
const NOTION_LINK = /^Application in Notion\s*\((\S+)\)\s*$/i;
const PEOPLE = /^With:\s*(.+)$/i;
const HEAD = /^(📧|📬|❓|🗓|🎤|📝|🔔|📥|🎯|⚠️|🏋️)\s*/u;

// The "Job emails & calendar" message's own blocks (src/ai/mail.py, tgcard.card): its title and "N updates" subtitle
// (the status strip already says both), then per update "Company · Role · Kind" (mail._head) with its summary under it,
// and a rejection's review line (src/ai/rejection.py line()):
// "🛠 Why rejected · Anthropic — Staff+ SWE: Hard skills (medium). <summary>".
const UPDATES_TITLE = /^(?:Job emails & calendar|\d+ updates?)$/;
const OUTCOME = /^([^·]+?)\s+·\s+(.+?)\s+·\s+([^·]+)$/;
const WHY = /Why rejected\s+·\s+(.+?):\s+([^():]+?)\s+\((low|medium|high)\)\.\s*(.*)$/u;
// "…role needing X; your experience is SRE/platform." reads as what the role wanted and what you bring.
const GAP = /^(.*?);\s*(?:but\s+)?your (?:experience|background|profile) (?:is|was|lies in|is in|centres on|centers on)\s+(.+)$/i;
function assessment(line) {
  const [, job, verdict, confidence, summary] = WHY.exec(line) || [];
  if (!job) return null;
  const gap = GAP.exec(summary);
  const sentence = text => { const t = text.trim().replace(/^./, c => c.toUpperCase()); return /[.!?]$/.test(t) ? t : `${t}.`; };
  return {job: job.trim(), verdict: verdict.trim(), confidence, summary: summary.trim(),
          focus: gap ? sentence(gap[1]) : '', background: gap ? sentence(gap[2]) : ''};
}

// The row's own result line as one sentence: "Gmail check: 1 new email(s) read, 0 update(s) recorded".
export function mailStatus(result) {
  const found = /(\d+)\s+new email\(s\)\s+read,\s*(\d+)\s+update\(s\)\s+recorded/i.exec(String(result || ''));
  if (!found) return {title: 'Check complete', sentence: '', emails: null, updates: null};
  const emails = Number(found[1]), updates = Number(found[2]);
  if (!emails && !updates) return {title: 'Check complete', sentence: 'No new job emails, and no application records changed.', emails, updates};
  const read = emails ? `${emails} email${emails === 1 ? '' : 's'} reviewed.` : 'No new job emails.';
  const changed = updates ? `${updates} application record${updates === 1 ? '' : 's'} changed.` : 'No application records changed.';
  return {title: 'Check complete', sentence: `${read} ${changed}`, emails, updates};
}

// One card per email the check read, with what it recorded on that job and the AI's reading of a rejection attached;
// an update or review no email row claims gets a card of its own. Matched on "Company — Role" (each writer cuts the
// role at 60 characters, so a prefix decides). Returns the cards and the report-row updates left for "What changed".
const jobKey = text => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
const sameJob = (a, b) => { const x = jobKey(a), y = jobKey(b); return !!x && !!y && (x.startsWith(y) || y.startsWith(x)); };
const splitJob = label => { const [company = '', ...role] = String(label || '').split(/\s+—\s+/); return {company: company.trim(), role: role.join(' — ').trim()}; };
export function mailResults(report) {
  const results = report.emails.map(email => ({...splitJob(email.by), email, outcome: null, assessment: null, update: null}));
  const claim = (label, make) => {
    const found = results.find(result => result.company && sameJob(`${result.company} — ${result.role}`, label));
    if (found) return found;
    const made = {...splitJob(label), email: null, outcome: null, assessment: null, update: null, ...make};
    results.push(made);
    return made;
  };
  for (const outcome of report.outcomes || []) {
    const result = claim(`${outcome.company} — ${outcome.role}`);
    if (!result.outcome) result.outcome = outcome;
  }
  for (const review of report.assessments || []) claim(review.job).assessment = review;
  // Every recorded update stays in "What changed" (the data the check moved); the email rows say what each email was.
  // Emails the check read but did not list (not about your applications) are counted, so the card's numbers add up.
  const hidden = Math.max(0, (report.status?.emails ?? 0) - report.emails.length);
  return {results, updates: report.updates, hidden};
}

// A next step with a clause in it reads as two paragraphs ("…salary expectations, with a further call planned to
// discuss …"): the pipeline's own punctuation decides the breaks, no word is added or dropped.
const paragraphs = text => String(text).split(/,\s+(?=with\b)/i)
  .flatMap(part => part.split(/(?<=\.)\s+(?=[A-Z])/))
  .map((part, i) => {
    const sentence = i ? part.charAt(0).toUpperCase() + part.slice(1) : part;
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;  // a comma became a break: finish the sentence
  })
  .filter(Boolean);

// What one recorded update changed on a job, from the run's own words: "Stage Applied → Confirmation received;
// Confirmation email set" -> [{from: 'Stage Applied', to: 'Confirmation received'}, {flag: 'Confirmation email set'}].
// A movement reads as a label and where it went; anything else ("Confirmation email set") is a flag on its own.
export function mailChanges(changes) {
  return String(changes || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const move = /^(.+?)\s*→\s*(.+)$/.exec(part);
    return move ? {from: move[1].trim(), to: move[2].trim()} : {flag: part};
  });
}

// The two lines a Gmail check's run page adds about the emails themselves: the update it recorded on a job
// ("📬 Application received · Canonical — SRE · Stage Applied → Confirmation received"), and one line per email read
// ("Thank you for applying … · us.greenhouse-mail.io · 01 Oct 03:45 — [recorded] · Canonical — SRE · changed …").
// src/notion/cron_runs.py writes both; the card draws them as rows, not as loose text.
const EMAIL_ACTION = /—\s*\[([^\]]+)\]\s*/;
// "· changed Stage Applied → Confirmation received" or "· nothing to record": where the email's tail stops being the
// job it is about. Matched from the tail's end (greedy), so "Canonical · nothing to record" keeps its job.
const EMAIL_TAIL = /\s*·\s*(?:changed\s+(.*)|((?:nothing|already known)\b.*))$/;
const EMAIL_HEAD = /^(.*?)\s+—\s+/;
// "📬 Application received · Canonical — Site Reliability Engineer · Stage Applied → Confirmation received":
// the summary ("Application received"), the job, then what moved. The job's own name has a "—" in it, so the change
// is found by what a change looks like (an arrow, or one of the fields an email can move), not by counting "·"s.
const UPDATED = /^([^·]+?)\s*·\s*(.*)$/;
const CHANGE = /→|^(?:Stage|Next interview|Confirmation email|Feedback status)\b/;
function parseUpdated(line) {
  const parsed = parseUpdate(line);
  // "Interview · <calendar title> — which job? Add details": not sure which job, so it asked you and moved nothing.
  const ask = /^(.*?)\s+—\s+which job\?/.exec(parsed.job);
  return ask ? {...parsed, job: ask[1].trim(), question: true} : parsed;
}
function parseUpdate(line) {
  const [, summary, rest] = UPDATED.exec(line.replace(DID, '').trim()) || [];
  if (!summary || rest === undefined) return {summary: '', job: (summary || '').trim(), changes: ''};
  const parts = rest.split(/\s*·\s*/);
  const at = parts.findIndex(part => CHANGE.test(part));
  return at < 0 ? {summary: summary.trim(), job: parts.join(' · ').trim(), changes: ''}
                : {summary: summary.trim(), job: parts.slice(0, at).join(' · ').trim(), changes: parts.slice(at).join(' · ').trim()};
}
// Any leading emoji (❌ Rejected, 📬 Application received, ❓ … which job?, …) or a "[recorded]" tag: a fixed list of
// emojis once missed ❌ and the rejection never reached "What changed" (5 Oct 2026).
const DID = /^\p{Extended_Pictographic}\uFE0F?|\[\w[\w ]*\]/u;

export function parseMailLines(fromRow = []) {
  const record = {updates: [], emails: [], assessments: []};
  for (const raw of fromRow.slice(1)) {
    const line = String(raw || '').trim();
    const action = EMAIL_ACTION.exec(line);
    if (action) {  // one email read: head — [action] · by · changed what
      if (action[1].trim() === 'not about your applications') continue;  // noise, not a finding (older runs listed these)
      const [, head] = EMAIL_HEAD.exec(line) || [];
      const tail = line.slice(action.index + action[0].length);
      const changed = EMAIL_TAIL.exec(tail);
      const by = (changed ? tail.slice(0, changed.index) : tail).split(/\s*·\s*/).filter(Boolean);
      const [subject = '', sender = '', time = ''] = (head || '').split(/\s+·\s+/);
      record.emails.push({subject, sender, time, action: action[1].trim(), by: by[0] || '', changes: (changed?.[1] || changed?.[2] || '')});
      continue;
    }
    const review = assessment(line);   // "🛠 Why rejected · …": the AI's reading of a rejection, not a change
    if (review) { record.assessments.push(review); continue; }
    if (DID.test(line)) record.updates.push(parseUpdated(line));
  }
  return record;
}

// fromRow: the run's own report lines, read from its Notion row (lib/run-history.js). A check that sent nothing to
// Telegram has no message, and then these are the only account of what it did: the update it recorded, with what it
// changed ("📬 … · Stage Applied → Confirmation received"). Its first line is the summary the status already shows,
// and the run's other report lines (the "Stages" cost line, warnings) are not about the emails.
export function parseMailReport(message, result = '', fromRow = []) {
  const said = String(message || '').split('\n');
  const parsed = parseMailLines(fromRow);
  // A message is what the check told Telegram; the report lines are what it did. Both are drawn, so a check (or a
  // later reader of its page) shows the emails it found even when it sent nothing. Each line is remembered with where
  // it came from: the card draws the report lines as its own structured sections, never as loose text.
  const lines = [...(message ? said.map(text => [text, false]) : []),
                 ...fromRow.slice(1).map(text => [text, true]).filter(([line]) => DID.test(String(line)))]
    .map(([line, fromRow_]) => [line.trim(), fromRow_]);  // blank lines kept: they end a message block
  if (!lines.some(([line]) => line) && !parsed.emails.length) return null;
  const report = {status: mailStatus(result), interview: null, topics: [], nextSteps: [], consent: '', notes: [],
                  url: '', updates: parsed.updates, emails: parsed.emails, outcomes: [], assessments: parsed.assessments};
  let reading = '';  // what the last line put us inside: the meeting's own lines, its topics, or the next step
  for (const [line, fromRow_] of lines) {
    if (!line) { if (reading === 'outcome') reading = ''; continue; }
    const link = NOTION_LINK.exec(line);
    if (link) { report.url = link[1]; reading = ''; continue; }
    if (CONSENT.test(line)) { report.consent = line; reading = ''; continue; }
    if (PREP_TITLE.test(line)) { reading = ''; continue; }   // the card's own title says it
    const prep = PREP_HEAD.exec(line);
    if (prep && !report.interview) { report.interview = {when: '', company: prep[1], title: prep[2], summary: '', where: '', people: []}; reading = 'prep'; continue; }
    const prepWhen = reading === 'prep' && report.interview && !report.interview.when && PREP_WHEN.exec(line);
    if (prepWhen) { report.interview.when = `${prepWhen[1]} ${prepWhen[2]}`; reading = 'meeting'; continue; }
    if (NEXT_HEAD.test(line)) { reading = 'nextHead'; continue; }
    if (reading === 'nextHead') { report.nextSteps.push(...paragraphs(line)); reading = 'next'; continue; }
    const at = SCHEDULED.exec(line);
    if (at) { report.interview = {when: at[1], company: at[2], title: at[3], summary: '', where: '', people: []}; reading = 'meeting'; continue; }
    if (WEAK.test(line)) { reading = 'topics'; continue; }
    const topic = TOPIC.exec(line);
    if (topic && reading === 'topics') { report.topics.push(topic[1]); continue; }
    const step = NEXT_STEP.exec(line);
    if (step) { report.nextSteps.push(...paragraphs(step[1])); reading = 'next'; continue; }
    if (reading === 'meeting' && report.interview) {
      const people = PEOPLE.exec(line);
      if (people) {
        report.interview.people = people[1].split(/\s*[,;]\s*/).map(name => name.trim()).filter(Boolean);
        continue;
      }
      if (!report.interview.summary) { report.interview.summary = line; continue; }
      if (!report.interview.where) { report.interview.where = line; continue; }
    }
    if (!fromRow_) {
      const review = assessment(line);
      if (review) { if (!report.assessments.some(seen => seen.job === review.job)) report.assessments.push(review); reading = ''; continue; }
      if (UPDATES_TITLE.test(line.replace(HEAD, ''))) { reading = ''; continue; }
      const outcome = OUTCOME.exec(line);
      if (outcome && !HEAD.test(line)) {
        report.outcomes.push({company: outcome[1].trim(), role: outcome[2].trim(), kind: outcome[3].trim(), summary: '', details: []});
        reading = 'outcome';
        continue;
      }
      const current = reading === 'outcome' && report.outcomes.at(-1);
      if (current) { if (current.summary) current.details.push(line); else current.summary = line; continue; }
    }
    const head = HEAD.exec(line);
    report.notes.push({icon: head ? head[1] : '', text: head ? line.slice(head[0].length) : line, fromRow: fromRow_});
    reading = '';
  }
  // The "which job?" note repeats the question the email's row already asks: drop it.
  report.notes = report.notes.filter(note => !/which job\?.*Answer in Job Pilotto/.test(note.text));
  const empty = !report.interview && !report.topics.length && !report.nextSteps.length && !report.consent && !report.notes.length
    && !report.outcomes.length && !report.assessments.length;
  return empty && !report.status.sentence ? null : report;
}

// A "which job?" line a Gmail check wrote stays in its run for good, long after the owner answered it in Focus.
// Given the questions Focus still holds, a line whose company is no longer among them reads as answered; one that
// is still open is left as it was. `pending` is null while Focus has not loaded: then nothing is judged.
const ASKED = /^(?:.*?·\s*)?([^:·—]+?)(?:\s+—\s+which job\?|:.*which job\?)/u;
export function settleQuestion(text, pending) {
  const line = String(text || '');
  if (!pending || !/which job\?/.test(line)) return line;
  const company = (ASKED.exec(line.replace(HEAD, '')) || [])[1]?.trim();
  if (!company) return line;
  const open = pending.some(item => `${item.headline || ''} ${item.title || ''} ${item.detail || ''}`.toLowerCase().includes(company.toLowerCase()));
  return open ? line : `${company} — which job? Answered in Focus`;
}
