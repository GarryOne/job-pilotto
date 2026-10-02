// "How did it go?" (Notion: Pricing & Plans, the outcome tap): the user tells Job Pilotto what an employer did, with one click on a job.
// It is written to Notion as the same stage event the Gmail check makes (src/notion/ledger.py), and, when Technical reports are on, counted
// anonymously: only the job BOARD (a known name, or a short hash of any other site), the outcome and a coarse number of days. Never the
// company, the role or the job's address, because where someone applied is theirs to keep.
import {boardName} from './control-events.js';

// outcome id (what the window sends) -> the ledger stage (src/notion/ledger.py EVENT_KINDS)
export const STAGES = {reply: 'Reply received', screening: 'Interview scheduled', offer: 'Offer', rejected: 'Rejected', no_response: 'No response'};
export const OUTCOMES = Object.keys(STAGES);
export const DAY_BUCKETS = ['0-3', '4-7', '8-14', '15-30', '31+'];

// Days between applying and now, as a bucket; '' when the date is unknown.
export function daysBucket(appliedOn, now = Date.now()) {
  const applied = Date.parse(String(appliedOn || '').slice(0, 10));
  if (!Number.isFinite(applied)) return '';
  const days = Math.max(0, Math.floor((now - applied) / 86400000));
  return days <= 3 ? '0-3' : days <= 7 ? '4-7' : days <= 14 ? '8-14' : days <= 30 ? '15-30' : '31+';
}

// -> {board, outcome, days} or null. The URL is read here and not kept.
export function anonymous({url, outcome, appliedOn}, now = Date.now()) {
  if (!OUTCOMES.includes(outcome)) return null;
  let host = '';
  try { host = new URL(String(url)).hostname; } catch { return null; }
  const board = boardName(host);
  return board ? {board, outcome, days: daysBucket(appliedOn, now)} : null;
}
