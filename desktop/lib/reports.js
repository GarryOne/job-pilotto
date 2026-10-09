// "Help improve Job Pilotto": when a fill leaves a field for a mechanical reason (a widget the extension couldn't
// operate), send the form STRUCTURE (site, labels, types, options, reason, extension version, and the field's HTML
// snapshot, scrubbed in the page by extension/page/snapshot.js and again by the Worker) to the project's Worker,
// which opens an issue for the daily fixer. Never answers or personal data. Part of the technical reports:
// on unless the user turned them off (Settings → Advanced, settings.telemetry); each site + field is reported once
// (once more when a snapshot exists for a field reported before snapshots, so its issue gets one).
import {read as keychainRead} from './keychain.js';

// The owner's app signs its reports (trusted → the daily fixer takes them); the token is in the app's secrets
// or, on the owner's Mac, the Keychain item job-pilotto.report.token. Without one, reports wait in triage.
export function reportToken(storage) {
  const saved = storage.secret('REPORT_TOKEN');
  if (saved || process.platform !== 'darwin') return saved;
  return keychainRead('job-pilotto.report.token') || '';   // a test run or a twin reads none of the owner's (lib/keychain.js)
}

export const ENDPOINT = process.env.JOB_PILOTTO_REPORT_URL || 'https://www.jobpilotto.workers.dev/report/fill-failure';
// The menu reasons are extension/menu-reason.js MENU_REASONS (what the pick observed) and the older fixed one; test/menu-reason-copies.test.js keeps them equal.
export const MECHANICAL = ['dropdown not clicked', 'dropdown clicked, but its menu did not open', 'dropdown clicked, but no option matched',
  'dropdown option clicked, but not selected', 'dropdown selected, but the reader cannot see it', 'dropdown that opens only on a real click',
  'answer given, but the field did not take it', 'question text not found on the page',
  'question on the page not read'];
const SNAPPED = '#snapshot';  // reportedFailures entry "<label key> #snapshot": reported with its snapshot
const key = label => String(label || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function build(run, reported = {}) {
  let site = '';
  try { site = new URL(run.url).hostname; } catch { return null; }
  const done = new Set(reported[site] || []);
  const byLabel = new Map((run.debug?.form || []).map(f => [key(f.label), f]));
  const snapshotOf = label => run.snapshots?.[label] || null;
  // A clicked dropdown's reason ends with its time ("… no option matched (1.5 s)"): without it, it is the mechanical one.
  const reasonOf = f => String(f.reason || '').replace(/\s*\([\d.]+ s\)$/, '');
  const fields = (run.trace || []).filter(f => MECHANICAL.some(reason => reasonOf(f).startsWith(reason)) && !done.has(`${key(f.label)} ${SNAPPED}`) &&
    !(done.has(key(f.label)) && !snapshotOf(f.label))).map(f => ({
    label: f.label, type: f.type || byLabel.get(key(f.label))?.type || '', required: !!f.required, reason: reasonOf(f),
    options: (byLabel.get(key(f.label))?.options || []).slice(0, 30), ...(snapshotOf(f.label) ? {snapshot: snapshotOf(f.label)} : {})}));
  return fields.length ? {site, version: run.debug?.version || '', fields} : null;
}

export async function send(storage, run, fetcher = globalThis.fetch, onSent = null) {
  const settings = storage.settings();
  if (settings.telemetry === false) return null;
  const report = build(run, settings.reportedFailures || {});
  if (!report) return null;
  const token = reportToken(storage);
  const response = await fetcher(ENDPOINT, {method: 'POST', body: JSON.stringify(report),
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}});
  if (!response.ok) throw new Error(`report not sent: ${response.status}`);
  onSent?.('fill report → /report/fill-failure', report);
  const reported = settings.reportedFailures || {};
  storage.saveSettings({reportedFailures: {...reported, [report.site]: [...new Set([...(reported[report.site] || []), ...report.fields.flatMap(f => [key(f.label), ...(f.snapshot ? [`${key(f.label)} ${SNAPPED}`] : [])])])]}});
  return report;
}
