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
