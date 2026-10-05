// Fill-failure reports from the Job Pilotto app: form STRUCTURE only (site, field labels, types, options, why a
// field couldn't be filled, extension version, and a scrubbed HTML snapshot of the field for replay tests: see
// snapshot.js, which scrubs it again here); never answers or personal data. A report signed with
// REPORT_TOKEN (the owner's app) is trusted and queued for the daily fixer; anything else lands as triage and
// waits for the owner. The Worker only starts the intake workflow on the public repo (existing GITHUB_TOKEN).
import { snapshotFromReport } from './snapshot.js';

const MECHANICAL = [
  'dropdown clicked, but no option matched',
  'dropdown that opens only on a real click',
  'answer given, but the field did not take it',
  'question text not found on the page',
];
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// All snapshots of one report together stay under this, so the intake workflow's input (64 KB) always fits.
export const SNAPSHOTS_MAX = 32 * 1024;

export function sanitize(report) {
  const site = text(report.site, 80).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return null;
  let room = SNAPSHOTS_MAX;
  const fields = (Array.isArray(report.fields) ? report.fields : []).slice(0, 20)
    .filter((f) => MECHANICAL.includes(f.reason))
    .map((f) => {
      const field = { label: text(f.label, 120), type: text(f.type, 30), required: !!f.required, reason: f.reason,
        options: (Array.isArray(f.options) ? f.options : []).slice(0, 30).map((o) => text(o, 60)) };
      const snapshot = f.snapshot && typeof f.snapshot === 'object' ? snapshotFromReport(f.snapshot) : '';
      if (snapshot && snapshot.length <= room) { field.snapshot = snapshot; room -= snapshot.length; }
      return field;
    });
  if (!fields.length) return null;
  return { site, version: text(report.version, 20), fields };
}

// Untrusted reports (anyone can POST) are limited per sender per day. Every report is counted by failure (site + fields);
// the intake workflow (an issue) starts only when it recurs (ISSUE_MIN_SENDERS / ISSUE_MIN_REPORTS), once a week per failure.
// Kept in the site's KV (WAITLIST, keys "report:…", expiring); without it (the bot's worker) every report dispatches.
export const PER_SENDER_PER_DAY = 10;
const WEEK = 7 * 24 * 3600;
// An issue is opened only for a failure that recurs: reported by this many different senders, or this many times in all. One
// report is data, not a ticket (2 Oct 2026: 17 single-field issues piled up before the self-improving system could judge them).
export const ISSUE_MIN_SENDERS = 3, ISSUE_MIN_REPORTS = 10;

async function fingerprint(report) {
  const data = new TextEncoder().encode(JSON.stringify([report.site, report.fields.map((f) => [f.label, f.reason])]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleReport(request, env, dispatch, now = Date.now()) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const report = sanitize(await request.json().catch(() => ({})));
  if (!report) return Response.json({ ok: false, error: 'no mechanical failures in the report' }, { status: 400 });
  const trusted = !!env.REPORT_TOKEN && request.headers.get('Authorization') === `Bearer ${env.REPORT_TOKEN}`;
  const kv = env.WAITLIST;
  if (!trusted && kv) {
    const sender = request.headers.get('CF-Connecting-IP') || 'unknown';
    const countKey = `report:sender:${sender}:${new Date(now).toISOString().slice(0, 10)}`;
    const count = Number(await kv.get(countKey)) || 0;
    if (count >= PER_SENDER_PER_DAY) return Response.json({ ok: false, error: 'too many reports today' }, { status: 429 });
    await kv.put(countKey, String(count + 1), { expirationTtl: 2 * 24 * 3600 });
  }
  if (kv) {
    // Counted per failure (site + fields), for everyone: distinct senders and total reports. Dispatched once, when it recurs.
    const key = `report:count:${await fingerprint(report)}`;
    const who = trusted ? 'owner' : (request.headers.get('CF-Connecting-IP') || 'unknown');
    const seen = JSON.parse((await kv.get(key)) || '{"senders":[],"n":0,"sent":false}');
    seen.n += 1;
    if (!seen.senders.includes(who) && seen.senders.length < 20) seen.senders.push(who);
    const recurs = seen.senders.length >= ISSUE_MIN_SENDERS || seen.n >= ISSUE_MIN_REPORTS;
    const open = recurs && !seen.sent;
    if (open) seen.sent = true;
    await kv.put(key, JSON.stringify(seen), { expirationTtl: open ? WEEK : 14 * 24 * 3600 });
    if (!open) return Response.json({ ok: true, trusted, counted: seen.n, senders: seen.senders.length, issue: false });
  }
  await dispatch(env, { report: JSON.stringify(report), trusted: String(trusted) }, 'fill-failure-intake.yml');
  return Response.json({ ok: true, trusted });
}
