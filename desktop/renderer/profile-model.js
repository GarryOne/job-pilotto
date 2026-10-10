// The Profile text as a form's data (Settings → Profile → Profile text) and back, without losing a word. The Profile is one markdown page the AI
// reads (scores, kits, tailored CVs): its "Hard constraints", "Compensation" and "Preferences" sections are tables of "row | value" and
// "- Label: value" lines (the template, docs/notion-profile-template.md); the form edits those values. Everything else (any other heading,
// notes, your own words) is kept as text: per section as "Notes", and for the rest of the page as one "rest" text. No code reads what a
// value MEANS: values stay free text for the AI; the dropdown-like SUGGESTIONS below only fill the input, they never limit it.
// No DOM here: guarded by test/profile-model.test.js.

// Sections the form knows, by the words their heading starts with (the headings of the template the app drafts the Profile from).
export const KINDS = [['hard constraints', 'constraints'], ['compensation', 'pay'], ['preferences', 'preferences']];
export const kindOf = heading => {
  const words = String(heading).toLowerCase().replace(/[^\p{L} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  return KINDS.find(([start]) => words.startsWith(start))?.[1] || null;
};

// Suggestions that fill a row's input (by its label, lower case). Never a limit: the value stays whatever the person types.
export const SUGGESTIONS = {
  'work mode': ['On-site', 'Hybrid', 'Remote', 'Hybrid or remote', 'On-site, hybrid or remote'],
  'minimum seniority': ['Junior', 'Mid-level', 'Senior', 'Staff or higher'],
  'workload': ['100% only', '80–100%', 'Part-time is fine'],
  'employment type': ['Permanent only', 'Permanent or contract', 'Contract only'],
  'recruiter listings': ['Allow', 'Down-rank', 'Exclude'],
};

const isTableLine = line => /^\s*\|/.test(line);
const isSeparator = line => /^\s*\|[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
const cellsOf = line => line.trim().replace(/^\||\|\s*$/g, '').split('|').map(cell => cell.trim());
const BULLET = /^\s*[-*]\s+([^:|]{1,60}):\s*(.*)$/;
const cleanCell = text => String(text).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim();   // a "|" typed in a cell would split it

function parseSection(heading, lines) {
  const kind = kindOf(heading);
  if (!kind) return null;
  const notes = [], table = [], bullets = [];
  for (const line of lines) {
    if (isTableLine(line)) table.push(line);
    else if (BULLET.test(line)) { const [, label, value] = line.match(BULLET); bullets.push({label: label.trim(), value: value.trim()}); }
    else notes.push(line);
  }
  const rows = table.filter(line => !isSeparator(line)).map(cellsOf);
  return {kind, heading, notes: notes.join('\n').trim(), header: rows[0] || ['', ''], rows: rows.slice(1), bullets};
}

// markdown -> {preamble, sections: [known sections, in page order], rest}
export function parseProfile(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const starts = lines.map((line, i) => (/^# /.test(line) ? i : -1)).filter(i => i >= 0);
  const preamble = lines.slice(0, starts.length ? starts[0] : lines.length).join('\n').trim();
  const sections = [], rest = [];
  starts.forEach((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const heading = lines[start].replace(/^# /, '').trim();
    const section = parseSection(heading, lines.slice(start + 1, end));
    if (section) sections.push(section); else rest.push(lines.slice(start, end).join('\n').trim());
  });
  return {preamble, sections, rest: rest.join('\n\n')};
}

function writeSection(s) {
  const out = [`# ${s.heading}`, ''];
  if (s.notes) out.push(s.notes, '');
  if (s.rows.length) {
    const width = Math.max(s.header.length, ...s.rows.map(r => r.length));
    const pad = r => Array.from({length: width}, (_, i) => cleanCell(r[i] ?? ''));
    out.push(`| ${pad(s.header).join(' | ')} |`, `|${'---|'.repeat(width)}`, ...s.rows.map(r => `| ${pad(r).join(' | ')} |`), '');
  }
  if (s.bullets.length) out.push(...s.bullets.map(b => `- ${cleanCell(b.label)}: ${cleanCell(b.value)}`), '');
  return out.join('\n');
}

// {preamble, sections, rest} -> markdown: the preamble, the known sections in order, then everything else.
export function serializeProfile({preamble, sections, rest}) {
  const parts = [];
  if (preamble) parts.push(preamble);
  parts.push(...sections.map(writeSection));
  if (String(rest || '').trim()) parts.push(String(rest).trim());
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// The comparable form of a text: what Save compares to know whether anything changed.
export const normalized = markdown => serializeProfile(parseProfile(markdown));
// ❓ is the app's own marker for "ask the person" (the Profile template): a value holding one is not answered yet.
export const needsAnswer = value => String(value).includes('❓');
