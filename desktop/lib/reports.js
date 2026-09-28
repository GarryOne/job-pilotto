// "Help improve Job Pilotto": when a fill leaves a field for a mechanical reason (a widget the extension couldn't
// operate), send the form STRUCTURE (site, labels, types, options, reason, extension version) to the project's
// Worker, which opens an issue for the daily fixer. Never answers or personal data. Opt-in (settings.shareFillReports);
// each site + field is reported once.
import {execFileSync} from 'node:child_process';

// The owner's app signs its reports (trusted → the daily fixer takes them); the token is in the app's secrets
// or, on the owner's Mac, the Keychain item job-pilotto.report.token. Without one, reports wait in triage.
export function reportToken(storage) {
  const saved = storage.secret('REPORT_TOKEN');
  if (saved || process.platform !== 'darwin') return saved;
  try { return execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.report.token', '-w'], {encoding: 'utf8'}).trim(); }
  catch { return ''; }
}

export const ENDPOINT = process.env.JOB_PILOTTO_REPORT_URL || 'https://sre-job-pilotto-bot.jobpilotto.workers.dev/report/fill-failure';
export const MECHANICAL = ['dropdown clicked, but no option matched', 'dropdown that opens only on a real click',
  'answer given, but the field did not take it'];
const key = label => String(label || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function build(run, reported = {}) {
  let site = '';
  try { site = new URL(run.url).hostname; } catch { return null; }
  const done = new Set(reported[site] || []);
  const byLabel = new Map((run.debug?.form || []).map(f => [key(f.label), f]));
  const fields = (run.trace || []).filter(f => MECHANICAL.includes(f.reason) && !done.has(key(f.label))).map(f => ({
    label: f.label, type: f.type || byLabel.get(key(f.label))?.type || '', required: !!f.required, reason: f.reason,
    options: (byLabel.get(key(f.label))?.options || []).slice(0, 30)}));
  return fields.length ? {site, version: run.debug?.version || '', fields} : null;
}

export async function send(storage, run, fetcher = globalThis.fetch) {
  const settings = storage.settings();
  if (!settings.shareFillReports) return null;
  const report = build(run, settings.reportedFailures || {});
  if (!report) return null;
  const token = reportToken(storage);
  const response = await fetcher(ENDPOINT, {method: 'POST', body: JSON.stringify(report),
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}});
  if (!response.ok) throw new Error(`report not sent: ${response.status}`);
  const reported = settings.reportedFailures || {};
  storage.saveSettings({reportedFailures: {...reported, [report.site]: [...new Set([...(reported[report.site] || []), ...report.fields.map(f => key(f.label))])]}});
  return report;
}
