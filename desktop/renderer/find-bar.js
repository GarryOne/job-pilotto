// ⌘F, find in the page (pages/find.js draws the bar and highlights the matches with the CSS Highlight API): the matching,
// stepping and the count. Done in the page, not with Electron's findInPage, which also matched the find box's own text.
// No window needed (test/find-bar.test.js).

// Where `query` starts in `text`, ignoring case; matches never overlap.
export function offsets(text, query) {
  const needle = String(query || '').toLowerCase();
  if (!needle.trim()) return [];
  const hay = String(text || '').toLowerCase(), out = [];
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) out.push(at);
  return out;
}

// The next match to show: 'next' / 'previous' wrap around; -1 when there is none.
export function step(index, total, how) {
  if (!total) return -1;
  if (index < 0 || index >= total) return how === 'previous' ? total - 1 : 0;
  return (index + (how === 'previous' ? -1 : 1) + total) % total;
}

// The count by the box: "3 of 12", "No matches", or nothing before a search.
export function countText(result, text) {
  if (!result || !String(text || '').trim()) return '';
  return result.total ? `${result.active} of ${result.total}` : 'No matches';
}
