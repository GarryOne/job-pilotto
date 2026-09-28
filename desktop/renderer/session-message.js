// Claude's last message in an Apply with Claude session, sorted for the session page (its words are kept; only
// where they're shown changes). Its report is a bullet list of labelled sections ("**Filled:** …", "**Yes/No
// questions:**" with sub-bullets, "**Check before you submit:**", "**Run record:** …"):
// - checks: what to look at before submitting (the items under a "Check …" / "Before you submit" section; with no
//   such section, every bullet: a short message's bullets are what it asks you to check);
// - audit: the run record / audit note;
// - done: the other sections (what Claude did), each {label, text, items};
// - intro: the lines outside the list (its opening sentence, its question).
const CHECK = /^(?:please\s+)?(?:check|before you submit|to check|worth checking|review before)/i;
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
