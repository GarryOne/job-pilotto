// The Jobs page's derived bits, kept free of the DOM so the tests can check them.

// Skills and topics shown as tags under a role, found in its title and fit summary (first match wins per tag).
const TAGS = [
  ['SRE', /\bsre\b|site reliability/i], ['DevOps', /\bdevops\b/i], ['Platform', /\bplatform\b/i],
  ['Observability', /observability|monitoring/i], ['OpenTelemetry', /opentelemetry|\botel\b/i],
  ['Kubernetes', /kubernetes|\bk8s\b/i], ['AWS', /\baws\b/i], ['GCP', /\bgcp\b|google cloud/i], ['Azure', /\bazure\b/i],
  ['Terraform', /terraform/i], ['IaC', /infrastructure[- ]as[- ]code|\biac\b/i], ['GitOps', /gitops|argo ?cd/i],
  ['Python', /\bpython\b/i], ['Go', /\b(Go|Golang|golang)\b/], ['Linux', /\blinux\b/i], ['Ceph', /\bceph\b/i],
  ['Databases', /database|postgres|mysql/i], ['Distributed Systems', /distributed systems?/i], ['Security', /security/i],
  ['Networking', /networking/i], ['On-call', /on-?call/i], ['AI infra', /\bai\b|\bml\b|machine learning|\bllm/i],
];
export function tags(job, max = 4) {
  const text = `${job.title || ''} ${job.reason || ''}`;
  return TAGS.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag).slice(0, max);
}

const WEEK = 7 * 24 * 3600 * 1000;
// The four counters above the list.
export function stats(jobs, total, now = Date.now()) {
  return {
    total: total ?? jobs.length,
    high: jobs.filter(job => job.fit >= 70).length,
    week: jobs.filter(job => now - Date.parse(job.first_seen_at) <= WEEK).length,
    companies: new Set(jobs.map(job => (job.company || '').trim().toLowerCase()).filter(Boolean)).size,
  };
}

// The list order: best match (as the engine ranked it), newest first, or by company.
export function sorted(jobs, by) {
  const list = [...jobs];
  if (by === 'newest') list.sort((a, b) => (Date.parse(b.first_seen_at) || 0) - (Date.parse(a.first_seen_at) || 0));
  if (by === 'company') list.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
  return list;
}

// A company's badge: its initials on a colour picked from its name, the same every time.
const HUES = [14, 200, 262, 152, 330, 38, 180, 4, 222, 96];
export function avatar(company) {
  const words = String(company || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  let hash = 0;
  for (const ch of String(company || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return {initials, hue: HUES[hash % HUES.length]};
}

// The work-mode chip: one word for the mode the source names ("Remote (stated)" reads Remote), else its own wording.
const MODES = [['remote', 'Remote', /remote/i], ['hybrid', 'Hybrid', /hybrid/i], ['onsite', 'On-site', /on.?site/i]];
export function workMode(text) {
  const [kind, label] = MODES.find(([, , pattern]) => pattern.test(text || '')) || ['', String(text || '')];
  return {kind, label};
}

// Fit ring colour band.
export const band = fit => (fit == null ? 'none' : fit >= 70 ? 'high' : fit >= 50 ? 'mid' : 'low');
