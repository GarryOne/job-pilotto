// The Notion Bug Tracker: every bug found, whoever found it (a local session logs each one with the owner, with its root cause and an e2e test
// idea). The local session has the context and the owner's judgement the loop lacks, so its rows are the Finder's best lessons: the escape rate
// (lib/loop-quality.mjs) and the weekly self-review's "bugs the Finder missed" (missedLessons below). Read with the CI's read-only connection.
// The Notion Bug Tracker's rows (every bug, whoever found it), read with the CI's Notion connection; the database id is the BUG_TRACKER_DB variable (no Notion id lives in code).
export async function readTracker() {
  const token = process.env.NOTION_BRAIN_TOKEN, db = process.env.BUG_TRACKER_DB;
  if (!token || !db) return {tracker: null, trackerWhy: 'the Bug Tracker is not connected (NOTION_BRAIN_TOKEN and BUG_TRACKER_DB)'};
  const rows = [];
  let cursor;
  try {
    do {
      const response = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'}, body: JSON.stringify({page_size: 100, ...(cursor ? {start_cursor: cursor} : {})})});
      if (!response.ok) return {tracker: null, trackerWhy: response.status === 404 ? 'the Bug Tracker is not shared with the "Job Pilotto Brain" Notion connection' : `the Bug Tracker answered ${response.status}`};
      const page = await response.json();
      rows.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor && rows.length < 1000);
  } catch (error) { return {tracker: null, trackerWhy: `the Bug Tracker could not be read (${String(error.message).slice(0, 60)})`}; }
  return {tracker: rows, trackerWhy: ''};
}

const text = (row, name) => { const prop = row.properties?.[name] || {}; return (prop.title || prop.rich_text || []).map(part => part.plain_text).join('') || prop.select?.name || prop.url || ''; };

// The bugs the Finder did not catch (Caught by e2e: "No - gap" or "Late …") in the last `days`, critical path and high severity first, as the
// weekly self-review's lesson list: what happened, why, and the test the session that found it proposed. -> markdown ('' when none).
export function missedLessons(rows = [], {now = Date.now(), days = 14, max = 12} = {}) {
  const missed = rows.filter(row => /^(No|Late)\b/i.test(text(row, 'Caught by e2e')))
    .filter(row => { const at = row.properties?.['Found on']?.date?.start; return !at || now - Date.parse(at) <= days * 86400000; });
  if (!missed.length) return '';
  const rank = row => (row.properties?.['Critical path']?.checkbox ? 0 : 2) + (/high/i.test(text(row, 'Severity')) ? 0 : 1);
  missed.sort((a, b) => rank(a) - rank(b));
  return ['', '## Bugs the Finder missed (logged by a local session with the owner: the strongest lessons, act on them first)', '',
    ...missed.slice(0, max).map(row => [`- **${text(row, 'Bug').slice(0, 120)}** (${[text(row, 'Severity'), text(row, 'Area'), row.properties?.['Critical path']?.checkbox ? 'critical path' : '', `found by ${text(row, 'Found by') || '?'}`, `caught: ${text(row, 'Caught by e2e')}`].filter(Boolean).join(' · ')})`,
      text(row, 'Root cause') ? `  - Root cause: ${text(row, 'Root cause').slice(0, 300)}` : '', text(row, 'e2e test idea') ? `  - Test idea from the session: ${text(row, 'e2e test idea').slice(0, 300)}` : '',
      text(row, 'GitHub issue') ? `  - Issue: ${text(row, 'GitHub issue')}` : ''].filter(Boolean).join('\n')), ''].join('\n');
}
