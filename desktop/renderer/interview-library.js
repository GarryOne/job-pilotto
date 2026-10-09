// Interviews → the library's read from Notion (src/ai/interviews.py list, through lib/interviews.js): what the page
// shows after it. Pure, so the failure cases are tested (test/interview-library.test.js): a failed read says why and
// keeps the rows already on screen (the last good copy), and is never shown as an empty table.
import {where} from './store-name.js';
export const libraryError = () => `Couldn't read your interviews from ${where()}. Try again with ↻; the reason is in the app log.`;

function ago(at) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (!at || Number.isNaN(minutes)) return '';
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

// result: the list's answer ({ok, interviews, insight, insight_error} or {ok: false, error}); shown: {rows, at} on
// screen now (at: when that copy was saved, if it came from the cache). ok false: the rows stay, error says why.
export function afterLoad(result, shown = {}) {
  if (result?.ok && Array.isArray(result.interviews)) {
    return {ok: true, rows: result.interviews, insight: result.insight || null, insightError: result.insight_error || '', error: ''};
  }
  const error = String(result?.error || '').trim() || libraryError();
  const rows = shown.rows || [];
  const when = shown.at ? ago(shown.at) : '';
  return {ok: false, rows, error,
    stats: rows.length ? `Couldn't refresh from ${where()} · showing the copy ${when ? `saved ${when}` : 'shown before'}` : ''};
}
