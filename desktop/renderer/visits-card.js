// The result of "Read sites only you can open" (Actions; lib/visits.js resultMessage writes it): parsed for its card. Pure.
// 🌐 Sites read / Read 4 of 5 sites · 186 jobs (61 new) / ✓ LinkedIn · 64 jobs (20 new) · <url> / ✗ Rolex · <why> · <url>
export function parseVisits(text) {
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines[0] !== '🌐 Sites read') return null;
  const head = /^Read (\d+) of (\d+) sites? · (\d+) jobs? \((\d+) new\)/.exec(lines[1] || '');
  if (!head) return null;
  const sites = [];
  for (const line of lines.slice(2)) {
    const row = /^([✓✗]) (.+?) · (.+) · (https?:\/\/\S+)$/.exec(line);
    if (row) sites.push({ok: row[1] === '✓', name: row[2], detail: row[3], url: row[4]});
  }
  return {kind: 'visits', read: Number(head[1]), total: Number(head[2]), jobs: Number(head[3]), fresh: Number(head[4]), sites};
}
