// Claude's last message in an Apply with Claude session, sorted for the session page (its words are kept; only
// where they're shown changes). Its report is labelled sections, either bullets ("- **Filled:** …" with
// sub-bullets) or heading lines ("**Left for you:**" followed by bullets):
// - needs: the items under a section that is for you ("Check before you submit", "Needs you", "Left for you",
//   "Kit checks");
// - checks: with no such section, every bullet (a short message's bullets are what it asks you to check);
// - audit: the run record / audit note;
// - done: the other sections (what Claude did), each {label, text, items};
// - intro: the lines outside the list (its opening sentence, its question).
const CHECK = /^(?:please\s+)?(?:check|before you submit|to check|worth checking|review before)/i;
const NEEDS = /^(?:needs you|left for you|for you|what (?:i|it) needs|kit checks|your call|to decide)/i;
const AUDIT = /^(?:run record|(?:form\s+)?audit)/i;

// "**Label:** text" → {label, text}; plain text → {label: '', text}.
export function splitLabel(text) {
  const match = String(text).match(/^\*\*([^*]+?)[:.]?\*\*[:.]?\s*(.*)$/);
  return match ? {label: match[1].trim(), text: match[2].trim()} : {label: '', text: String(text).trim()};
}

// The hand-over's last line (apply-to-job skill, step 8), fixed and never translated: Claude may write the rest in any language.
export const READY_LINE = /^status:\s*ready-for-review\.?$/i;
export function readSessionMessage(message) {
  const sections = [], intro = [];
  let audit = '', heading = false;  // heading: the last section is a "**Label:**" line, so bullets under it are its items
  for (const raw of String(message || '').split(/\n/)) {
    if (!raw.trim() || READY_LINE.test(raw.trim())) continue;   // the status line is for the app, not the reader
    const bullet = raw.match(/^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet && (bullet[1].length >= 2 || heading) && sections.length) { sections[sections.length - 1].items.push(bullet[2].trim()); continue; }
    if (bullet) { sections.push({...splitLabel(bullet[2]), items: []}); continue; }
    const line = raw.trim();
    const {label, text} = splitLabel(line);
    heading = false;
    if (label && AUDIT.test(label)) audit = text;
    else if (label) { sections.push({label, text, items: []}); heading = true; }
    else intro.push(line);
  }
  const checks = [], needs = [], done = [];
  const itemsOf = section => (section.items.length ? section.items : [section.text]).filter(Boolean);
  const listed = sections.some(section => CHECK.test(section.label) || NEEDS.test(section.label));
  for (const section of sections) {
    if (AUDIT.test(section.label)) audit = [section.text, ...section.items].filter(Boolean).join(' ');
    else if (NEEDS.test(section.label) || CHECK.test(section.label)) needs.push(...itemsOf(section));
    else if (!listed) checks.push(section.label ? `**${section.label}:** ${section.text}`.trim() : section.text);
    else done.push(section);
  }
  return {checks, needs, audit, done, intro};
}

// Claude's latest step while it works: the last "●" line in the terminal output (colours and cursor moves removed).
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]/g;
export function latestStep(output) {
  const plain = output.replace(/\x1b\[\d*C/g, ' ').replace(ANSI, '');
  const steps = [...plain.matchAll(/●\s+([^\r\n●]{6,200})/g)].map(match => match[1].replace(/\s+/g, ' ').trim());
  return steps.pop() || '';
}

// A fact Claude couldn't find: "❓ **Degree result**: none on file. **Suggested:** 8.5/10 (guess)", or a line that
// says it has no source ("⚠️ Any relatives working at N26? (required) Also no source.").
// → {question, why, suggested} (the question without its ** marks; suggested '' when Claude gave none), or null.
const SUGGESTED = /\s*\**\s*(?:suggested(?: answer)?|most likely|best guess)\s*:\**\s*:?\s*/i;
const NO_SOURCE = /\b(?:no source|not on file|nothing on file|no answer (?:in|on))\b/i;
const MARKS = /^(?:❓|⚠️?|⚖️?|👀)\s*/u;
export function readAsk(check) {
  const text = String(check || '').trim();
  if (!text.startsWith('❓') && !NO_SOURCE.test(text)) return null;
  const [asked, ...rest] = text.replace(MARKS, '').split(SUGGESTED);
  const suggested = rest.join(' ').replace(/\*\*/g, '').trim();
  const mark = asked.search(/\?|\*{0,2}\s*:\*{0,2}\s/);
  const cut = mark >= 0 && asked[mark] === '?' ? mark + 1 : mark;
  const question = (cut >= 0 ? asked.slice(0, cut) : asked).replace(/\*\*/g, '').replace(/^["“\s]+|[\s:.]+$/g, '').trim();
  const why = cut >= 0 ? asked.slice(cut).replace(/^["”*\s]*/, '').replace(/^\((?:required|optional)\)\s*/i, '').replace(/^:?\*{0,2}\s*/, '').trim() : '';
  return {question, why, suggested};
}

// The checks split in two for the session page:
// - needs: what only the owner can do — {kind: 'ask'} a fact Claude couldn't find (readAsk's fields),
//   {kind: 'agree'} an agreement to tick yourself (⚖️, a GDPR notice), {kind: 'confirm'} a judgement call;
// - filled: the rest, what Claude filled and reports (a glance is enough), {text, problem} where problem marks
//   what went wrong on the way ("the extension failed …"). A bare heading ("Dropdowns:") is dropped.
// forYou: the items come from a section that is all for the owner ("Left for you"), so none of them is "filled".
const AGREE = /^⚖|\b(?:pledge|privacy|gdpr|terms|consent|acknowledg\w*)\b.*\b(?:yourself|you tick|tick it|tick them)\b/i;
const CONFIRM = /^👀|\b(?:make sure|you choose|your call|decide|confirm|happy (?:to|with|disclosing)|you'll need|involves|requires you|travel|relocat)/i;
// A judgement call with the action Claude recommends: "**Pay:** below your minimum. **Recommended:** keep it"
// → {text, label: 'Pay', recommended: 'keep it'} (recommended '' when Claude gave none).
const RECOMMENDED = /\s*\**\s*recommended(?: action)?\s*:\**\s*:?\s*/i;
export function readConfirm(check) {
  const [text, ...rest] = String(check).split(RECOMMENDED);
  return {text: text.trim(), label: splitLabel(text).label, recommended: rest.join(' ').replace(/\*\*/g, '').trim()};
}
export const PROBLEM = /\b(?:failed|error|couldn't|could not|didn't work|blocked|by hand|timed out)\b/i;
// Developer chatter, not something on the form: a test or a file named in `backticks` (`test_watch`, `config/search.json`).
// Such an item stays in Claude's report but gets no card, and no "Review in form" button it could never satisfy.
export const DEV_TALK = /`[^`\n]*(?:\btest_\w+|\.(?:json|py|jsx?|tsx?|md|env|sh|ya?ml)\b)[^`\n]*`/i;
// Developer talk in a line of Claude's words: a test or file in `backticks`, or the repo's own vocabulary (git, a worktree,
// HEAD, a checkout, uncommitted changes, test failures). A job form never says these, so such a line is not shown to the applicant.
export const isDevTalk = line => DEV_TALK.test(line)
  || /\b(?:git|worktrees?|HEAD|checkouts?|uncommitted|commits?|repo|repository|test failures?|unit tests?|test suite)\b/i.test(line);
export function sortChecks(checks, {forYou = false} = {}) {
  const needs = [], filled = [];
  for (const check of checks) {
    const text = String(check).trim();
    if (!text || /^[^:]{1,40}:$/.test(text.replace(/\*/g, '')) || isDevTalk(text)) continue;
    const ask = readAsk(text), plain = text.replace(MARKS, '');
    if (ask) needs.push({kind: 'ask', text, ...ask});
    else if (AGREE.test(text)) needs.push({kind: 'agree', text: plain});
    else if (forYou && PROBLEM.test(text) && !CONFIRM.test(text)) filled.push({text, problem: true});
    else if (forYou || CONFIRM.test(text)) needs.push({kind: 'confirm', ...readConfirm(plain)});
    else filled.push({text, problem: PROBLEM.test(text)});
  }
  return {needs, filled};
}

// Claude's **bold** marks, which a row shows as plain words.
export const unbold = text => String(text || '').replace(/\*\*/g, '');
// An item that is a reply to Claude, not something in the form: "Reply **ok**, and I'll click Create an account…" → 'ok', else ''.
export function replyOf(text) {
  const match = unbold(text).match(/^\s*(?:reply|answer|say|type)\s+["“']?([\w-]{1,20})["”']?(?=[\s,.;:]|$)/i);
  return match ? match[1] : '';
}
