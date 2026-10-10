// A host as the usage-weighted pool may send it (docs/superpowers/specs/2026-10-10-usage-weighted-pool.md): a plain host name, or null. Never trimmed into shape, so a
// path, query, port, user, token or address cannot ride along. The site checks again (site/src/hostuse.js); both read the same cases (site/test/host-cases.json,
// test/host-clean.test.js).
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function cleanHost(value) {
  const raw = String(value ?? '');
  if (!raw || raw.length > 80 || raw !== raw.trim()) return null;
  const host = raw.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.');
  if (labels.length < 2 || labels.length > 6 || !labels.every(label => LABEL.test(label))) return null;
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return null;
  if (labels.some(label => /^[0-9a-f]{20,}$/.test(label) || (label.length >= 28 && /\d/.test(label)))) return null;
  return host;
}
