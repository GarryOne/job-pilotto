// Claude's last message in an Apply with Claude session, sorted for the session page (its words are kept; only
// where they're shown changes). Its report is a bullet list of labelled sections ("**Filled:** …", "**Yes/No
// questions:**" with sub-bullets, "**Check before you submit:**", "**Run record:** …"):
// - checks: what to look at before submitting (the items under a "Check …" / "Before you submit" section; with no
//   such section, every bullet: a short message's bullets are what it asks you to check);
// - audit: the run record / audit note;
// - done: the other sections (what Claude did), each {label, text, items};
// - intro: the lines outside the list (its opening sentence, its question).
const CHECK = /^(?:please\s+)?(?:check|before you submit|to check|worth checking|review before|needs you|what (?:i|it) needs)/i;
const AUDIT = /^(?:run record|(?:form\s+)?audit)/i;

// "**Label:** text" → {label, text}; plain text → {label: '', text}.
export function splitLabel(text) {
  const match = String(text).match(/^\*\*([^*]+?)[:.]?\*\*[:.]?\s*(.*)$/);
  return match ? {label: match[1].trim(), text: match[2].trim()} : {label: '', text: String(text).trim()};
}

export function readSessionMessage(message) {
  const sections = [], intro = [];
  let audit = '';
  for (const raw of String(message || '').split(/\n/)) {
    if (!raw.trim()) continue;
    const bullet = raw.match(/^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet && bullet[1].length >= 2 && sections.length) { sections[sections.length - 1].items.push(bullet[2].trim()); continue; }
    if (bullet) { sections.push({...splitLabel(bullet[2]), items: []}); continue; }
    const line = raw.trim();
    const {label, text} = splitLabel(line);
    if (label && AUDIT.test(label)) audit = text;
    else intro.push(line);
  }
  const checks = [], done = [];
  const checkSections = sections.filter(section => CHECK.test(section.label));
  for (const section of sections) {
    if (AUDIT.test(section.label)) audit = [section.text, ...section.items].filter(Boolean).join(' ');
    else if (checkSections.includes(section)) checks.push(...(section.items.length ? section.items : [section.text]).filter(Boolean));
    else if (!checkSections.length) checks.push(section.label ? `**${section.label}:** ${section.text}`.trim() : section.text);
    else done.push(section);
  }
  return {checks, audit, done, intro};
}

// Claude's latest step while it works: the last "●" line in the terminal output (colours and cursor moves removed).
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]/g;
export function latestStep(output) {
  const plain = output.replace(/\x1b\[\d*C/g, ' ').replace(ANSI, '');
  const steps = [...plain.matchAll(/●\s+([^\r\n●]{6,200})/g)].map(match => match[1].replace(/\s+/g, ' ').trim());
  return steps.pop() || '';
}

// A ❓ check is a fact Claude couldn't find: "❓ **Degree result**: none on file. **Suggested:** 8.5/10 (guess)".
// → {question, why, suggested} (the question without its ** marks; suggested '' when Claude gave none), or null.
const SUGGESTED = /\s*\**\s*(?:suggested(?: answer)?|most likely|best guess)\s*:\**\s*:?\s*/i;
export function readAsk(check) {
  const text = String(check || '').trim();
  if (!text.startsWith('❓')) return null;
  const [asked, ...rest] = text.replace(/^❓\s*/, '').split(SUGGESTED);
  const suggested = rest.join(' ').replace(/\*\*/g, '').trim();
  const colon = asked.search(/\*{0,2}\s*:\*{0,2}\s/);
  const question = (colon >= 0 ? asked.slice(0, colon) : asked).replace(/\*\*/g, '').replace(/[\s:.]+$/, '').trim();
  const why = colon >= 0 ? asked.slice(colon).replace(/^\*{0,2}\s*:\*{0,2}\s*/, '').trim() : '';
  return {question, why, suggested};
}

// The checks split in two for the session page:
// - needs: what only the owner can do — {kind: 'ask'} a fact Claude couldn't find (❓, with readAsk's fields),
//   {kind: 'agree'} an agreement to tick yourself (⚖️), {kind: 'confirm'} a judgement call (a disclosure, travel);
// - filled: the rest, what Claude filled and reports (a glance is enough), {text, problem} where problem marks
//   what went wrong on the way ("the extension failed …"). A bare heading ("Dropdowns:") is dropped.
const AGREE = /^⚖|\b(?:pledge|privacy notice|terms and conditions|consent)\b.*\byourself\b/i;
const CONFIRM = /^👀|\b(?:make sure|you choose|your call|decide|confirm|happy (?:to|with|disclosing)|you'll need|involves|requires you|travel|relocat)/i;
export const PROBLEM = /\b(?:failed|error|couldn't|could not|didn't work|blocked|by hand|timed out)\b/i;
export function sortChecks(checks) {
  const needs = [], filled = [];
  for (const check of checks) {
    const text = String(check).trim();
    if (!text || /^[^:]{1,40}:$/.test(text.replace(/\*/g, ''))) continue;
    const ask = readAsk(text);
    if (ask) needs.push({kind: 'ask', text, ...ask});
    else if (AGREE.test(text)) needs.push({kind: 'agree', text: text.replace(/^⚖️?\s*/, '')});
    else if (CONFIRM.test(text)) needs.push({kind: 'confirm', text: text.replace(/^👀\s*/, '')});
    else filled.push({text, problem: PROBLEM.test(text)});
  }
  return {needs, filled};
}
