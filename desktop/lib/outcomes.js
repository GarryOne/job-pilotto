// "How did it go?" (Notion: Pricing & Plans, the outcome tap): the user tells Job Pilotto what an employer did, with one click on a job.
// It is written to Notion as the same stage event the Gmail check makes (src/notion/ledger.py), and, when Technical reports are on, counted
// anonymously: only the job BOARD (a known name, or a short hash of any other site), the outcome and a coarse number of days. Never the
// company, the role or the job's address, because where someone applied is theirs to keep.
import {boardName} from './control-events.js';

// withdrawn is the owner's own decision, not what an employer did: written to Notion, never counted (main.js).
// outcome id (what the window sends) -> the ledger stage (src/notion/ledger.py EVENT_KINDS)
export const STAGES = {reply: 'Reply received', screening: 'Interview scheduled', offer: 'Offer', rejected: 'Rejected', no_response: 'No response', withdrawn: 'Withdrawn'};
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

// Job boards and aggregators the app reads besides the ATS feeds (src/sources/*): a source kind of their own, so the product can see which
// ones give useful jobs. Fixed names only.
const SOURCE_HOSTS = [['jobsch', /(^|\.)jobs\.ch$/], ['swissdevjobs', /swissdevjobs\.ch$/], ['techtree', /techtree\.dev$/], ['arbeitnow', /arbeitnow\.com$/],
  ['himalayas', /himalayas\.app$/], ['jobicy', /jobicy\.com$/], ['adzuna', /adzuna\./], ['jooble', /jooble\.org$/], ['join', /(^|\.)join\.com$/],
  ['workday', /myworkdayjobs\.com$/], ['umantis', /umantis\.com$/], ['abacus', /abaservices\.ch$/]];

const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };

// [{host, seen, acted, dismissed, heard, good, hours}] (the renderer's per-host counts) -> per source KIND: a known ATS or board name, or "other"
// for any other site (a company's own careers site). A host never leaves the Mac. `good`: jobs scored 70+; `hours`: the median hours from a
// posting's date to the day it was found, over the kind's jobs that have both dates.
export function sourceStats(hosts, boardName) {
  const totals = new Map(), delays = new Map();
  for (const item of Array.isArray(hosts) ? hosts : []) {
    const host = String(item?.host || '').toLowerCase();
    const board = boardName(host);
    const kind = /^[a-z]+$/.test(board) ? board : (SOURCE_HOSTS.find(([, pattern]) => pattern.test(host))?.[0] || 'other');
    const entry = totals.get(kind) || {board: kind, seen: 0, acted: 0, dismissed: 0, heard: 0, good: 0};
    for (const field of ['seen', 'acted', 'dismissed', 'heard', 'good']) entry[field] += Math.max(0, Math.round(Number(item?.[field])) || 0);
    totals.set(kind, entry);
    delays.set(kind, [...(delays.get(kind) || []), ...(Array.isArray(item?.hours) ? item.hours.filter(Number.isFinite) : [])]);
  }
  return [...totals.values()].map(entry => ({...entry, hours: median(delays.get(entry.board) || [])}));
}
