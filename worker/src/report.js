// Fill-failure reports from the Job Pilotto app: form STRUCTURE only (site, field labels, types, options, why a
// field couldn't be filled, extension version); never answers or personal data. A report signed with
// REPORT_TOKEN (the owner's app) is trusted and queued for the daily fixer; anything else lands as triage and
// waits for the owner. The Worker only starts the intake workflow on the public repo (existing GITHUB_TOKEN).
const MECHANICAL = [
  'dropdown clicked, but no option matched',
  'dropdown that opens only on a real click',
  'answer given, but the field did not take it',
];
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function sanitize(report) {
  const site = text(report.site, 80).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return null;
  const fields = (Array.isArray(report.fields) ? report.fields : []).slice(0, 20)
    .filter((f) => MECHANICAL.includes(f.reason))
    .map((f) => ({ label: text(f.label, 120), type: text(f.type, 30), required: !!f.required, reason: f.reason,
      options: (Array.isArray(f.options) ? f.options : []).slice(0, 30).map((o) => text(o, 60)) }));
  if (!fields.length) return null;
  return { site, version: text(report.version, 20), fields };
}

export async function handleReport(request, env, dispatch) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const report = sanitize(await request.json().catch(() => ({})));
  if (!report) return Response.json({ ok: false, error: 'no mechanical failures in the report' }, { status: 400 });
  const trusted = !!env.REPORT_TOKEN && request.headers.get('Authorization') === `Bearer ${env.REPORT_TOKEN}`;
  await dispatch(env, { report: JSON.stringify(report), trusted: String(trusted) }, 'fill-failure-intake.yml');
  return Response.json({ ok: true, trusted });
}
