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
const HEAD = /^(📧|❓|🗓|🎤|📝|🔔|📥|🎯|⚠️|🏋️)\s*/u;

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

export function parseMailReport(message, result = '') {
  const lines = String(message || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const report = {status: mailStatus(result), interview: null, topics: [], nextSteps: [], consent: '', notes: [], url: ''};
  let reading = '';  // what the last line put us inside: the meeting's own lines, its topics, or the next step
  for (const line of lines) {
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
    report.notes.push({icon: head ? head[1] : '', text: head ? line.slice(head[0].length) : line});
    reading = '';
  }
  const empty = !report.interview && !report.topics.length && !report.nextSteps.length && !report.consent && !report.notes.length;
  return empty && !report.status.sentence ? null : report;
}
