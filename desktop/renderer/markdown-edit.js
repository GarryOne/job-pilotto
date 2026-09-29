// Inline editing of the drafted Profile / standard answers (wizard step 5): one edited cell or line goes back
// into its markdown line, the rest of the document untouched.
const clean = text => String(text).replace(/\s*\n\s*/g, ' ').trim();

// "| a | b | c |", cell 1, "x" -> "| a | x | c |" (a "|" typed in a cell would split it: shown as "/").
export function replaceCell(line, index, text) {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  cells[index] = clean(text).replace(/\|/g, '/');
  return `| ${cells.join(' | ')} |`;
}

// "  - old" -> "  - new"; a paragraph line is replaced whole.
export function replaceLine(line, text) {
  const bullet = line.match(/^(\s*[-*]\s+)/);
  return (bullet ? bullet[1] : '') + clean(text);
}

// The markdown with line `index` replaced.
export function withLine(markdown, index, line) {
  const lines = markdown.split('\n');
  lines[index] = line;
  return lines.join('\n');
}

// A goal corrected in the review (wizard: Your strategy → the tiles) goes into the drafted Profile, the text that is
// saved to Notion: its Hard constraints row (or the Compensation line for the salary). A Profile without that row gets
// the value in a "Confirmed during setup" section, so the correction is never lost.
export const GOAL_ROWS = {
  seniority: {label: 'Minimum seniority', match: /seniority/i},
  work_mode: {label: 'Work mode', match: /^work mode$/i},
  languages: {label: 'Languages I can work in', match: /languages i can work in/i},
  minimum_salary: {label: 'Minimum acceptable', match: /minimum acceptable|minimum salary/i, line: true},
};
export function applyGoal(markdown, key, value) {
  const row = GOAL_ROWS[key];
  const lines = String(markdown || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|')) {
      const first = line.replace(/^\|/, '').split('|')[0].replace(/\*\*/g, '').trim();
      if (row.match.test(first) && !/^:?-{2,}:?$/.test(first)) return withLine(markdown, i, replaceCell(lines[i], 1, value));
    } else if (row.line) {
      const m = lines[i].match(/^(\s*[-*]\s+)?(\**[^:]*?\**)\s*:/);
      if (m && row.match.test(m[2].replace(/\*\*/g, ''))) return withLine(markdown, i, `${m[1] || ''}${m[2]}: ${clean(value)}`);
    }
  }
  const heading = '# Confirmed during setup';
  const bullet = `- ${row.label}: ${clean(value)}`;
  const at = lines.findIndex(line => line.trim() === heading);
  if (at < 0) return `${String(markdown || '').trimEnd()}\n\n${heading}\n\n${bullet}\n`;
  const existing = lines.findIndex((line, i) => i > at && line.startsWith(`- ${row.label}:`));
  if (existing >= 0) return withLine(markdown, existing, bullet);
  lines.splice(at + 2 > lines.length ? lines.length : at + 2, 0, bullet);
  return lines.join('\n');
}
