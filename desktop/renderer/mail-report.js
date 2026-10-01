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
const WEAK = /^🏋️\s*Answered weakly in past interviews/i;
const TOPIC = /^[•·]\s*(.+)$/;
const NEXT_STEP = /^📝\s*(.+)$/;
const CONSENT = /^Recording\?/i;
const NOTION_LINK = /^Application in Notion\s*\((\S+)\)\s*$/i;
const PEOPLE = /^With:\s*(.+)$/i;
const HEAD = /^(📧|📬|❓|🗓|🎤|📝|🔔|📥|🎯|⚠️|🏋️)\s*/u;

// The row's own result line as one sentence: "Gmail check: 1 new email(s) read, 0 update(s) recorded".
export function mailStatus(result) {
  const found = /(\d+)\s+new email\(s\)\s+read,\s*(\d+)\s+update\(s\)\s+recorded/i.exec(String(result || ''));
  if (!found) return {title: 'Check complete', sentence: ''};
  const emails = Number(found[1]), updates = Number(found[2]);
  if (!emails && !updates) return {title: 'Check complete', sentence: 'No new job emails, and no application records changed.'};
  const read = emails ? `${emails} email${emails === 1 ? '' : 's'} reviewed.` : 'No new job emails.';
  const changed = updates ? `${updates} application record${updates === 1 ? '' : 's'} changed.` : 'No application records changed.';
  return {title: 'Check complete', sentence: `${read} ${changed}`};
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
  const [, summary, rest] = UPDATED.exec(line.replace(DID, '').trim()) || [];
  if (!summary || rest === undefined) return {job: (summary || '').trim(), changes: ''};
  const parts = rest.split(/\s*·\s*/);
  const at = parts.findIndex(part => CHANGE.test(part));
  return at < 0 ? {job: parts.join(' · ').trim(), changes: ''}
                : {job: parts.slice(0, at).join(' · ').trim(), changes: parts.slice(at).join(' · ').trim()};
}
const DID = /^(📧|📬|❓|🗓|🎤|📝|🔔|📥|🎯|⚠️|🏋️)|\[\w[\w ]*\]/u;

export function parseMailLines(fromRow = []) {
  const record = {updates: [], emails: []};
  for (const raw of fromRow.slice(1)) {
    const line = String(raw || '').trim();
    const action = EMAIL_ACTION.exec(line);
    if (action) {  // one email read: head — [action] · by · changed what
      const [, head] = EMAIL_HEAD.exec(line) || [];
      const tail = line.slice(action.index + action[0].length);
      const changed = EMAIL_TAIL.exec(tail);
      const by = (changed ? tail.slice(0, changed.index) : tail).split(/\s*·\s*/).filter(Boolean);
      const [subject = '', sender = '', time = ''] = (head || '').split(/\s+·\s+/);
      record.emails.push({subject, sender, time, action: action[1].trim(), by: by[0] || '', changes: (changed?.[1] || changed?.[2] || '')});
      continue;
    }
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
    .map(([line, fromRow_]) => [line.trim(), fromRow_]).filter(([line]) => line);
  if (!lines.length && !parsed.emails.length) return null;
  const report = {status: mailStatus(result), interview: null, topics: [], nextSteps: [], consent: '', notes: [],
                  url: '', updates: parsed.updates, emails: parsed.emails};
  let reading = '';  // what the last line put us inside: the meeting's own lines, its topics, or the next step
  for (const [line, fromRow_] of lines) {
    const link = NOTION_LINK.exec(line);
    if (link) { report.url = link[1]; reading = ''; continue; }
    if (CONSENT.test(line)) { report.consent = line; reading = ''; continue; }
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
    const head = HEAD.exec(line);
    report.notes.push({icon: head ? head[1] : '', text: head ? line.slice(head[0].length) : line, fromRow: fromRow_});
    reading = '';
  }
  const empty = !report.interview && !report.topics.length && !report.nextSteps.length && !report.consent && !report.notes.length;
  return empty && !report.status.sentence ? null : report;
}
