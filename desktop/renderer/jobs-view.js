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

// Place and mode on one line, without saying the mode twice ("Remote (Europe)" + Remote reads "Remote (Europe)").
export function placeAndMode(location, mode) {
  const {kind, label} = workMode(mode);
  const said = kind && MODES.find(([k]) => k === kind)[2].test(location || '');
  return [location, mode && !said ? label : ''].filter(Boolean).join(' · ');
}

// Fit ring colour band.
export const band = fit => (fit == null ? 'none' : fit >= 70 ? 'high' : fit >= 50 ? 'mid' : 'low');

// Under the ring in the compact list.
export const matchLabel = fit => (fit == null ? 'Not scored' : fit >= 70 ? 'Strong match' : fit >= 50 ? 'Good match' : 'Weak match');

// When a job was first seen: "just now", "5h ago", "3d ago", "2w ago".
export function ago(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}
