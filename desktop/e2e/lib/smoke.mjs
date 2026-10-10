// Layer 3 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): the nightly live smoke's logic, no browser here.
// parseLive reads where a live run got to from its own printed log lines (lib/apply-live.mjs), compare finds what reached less than last time, pickPosting
// rotates through the owner's postings of each site shape. Runner: e2e/smoke.mjs. Guard: e2e/test/smoke.test.mjs.
export const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];
const rank = step => STEPS.indexOf(step);

// -> {reached, filled, left, kinds: [page kinds seen], errors: [lines]}
export function parseLive(output) {
  const lines = String(output || '').split('\n');
  let reached = 'none', filled = null, left = null;
  const kinds = [], errors = [];
  const reach = step => { if (rank(step) > rank(reached)) reached = step; };
  for (const line of lines) {
    if (/Apply pressed on /.test(line)) reach('posting');
    const kind = line.match(/page kind: ([\w-]+)/);
    if (kind) { kinds.push(kind[1]); if (kind[1] === 'account') reach('account'); if (/^(form|account-form)$/.test(kind[1])) reach('form'); }
    if (/account (judgment|result)[^:]*: needs_code|"botCheck":true|bot check/.test(line)) reach('code/bot');
    const fields = line.match(/fields: (\d+) filled, (\d+) left/);
    if (fields && !/account page/.test(line)) { filled = Number(fields[1]); left = Number(fields[2]); reach('form'); if (left === 0 && filled > 0) reach('ready'); }
    if (/(^|\s)(✗|not ok)\b|Error:|crash/.test(line)) errors.push(line.trim().slice(0, 200));
  }
  return {reached, filled, left, kinds: [...new Set(kinds)], errors};
}

// The same shape reaching an earlier step than last night, or filling fewer fields on the same posting, is a regression.
export function compare(previous = {}, current = {}) {
  const out = [];
  for (const [shape, now] of Object.entries(current)) {
    const before = previous[shape];
    if (!before || now.note || before.note) continue;   // a posting gone, or no posting: not a regression of ours
    if (rank(now.reached) < rank(before.reached)) out.push({shape, why: `reached ${now.reached}, last time ${before.reached}`, url: now.url});
    else if (now.url === before.url && before.filled != null && now.filled != null && now.filled < before.filled) out.push({shape, why: `filled ${now.filled}, last time ${before.filled}`, url: now.url});
  }
  return out;
}

// One of a shape's postings, rotating by day (the list is the owner's own jobs matching the shape's patterns).
export const pickPosting = (postings, day = new Date()) => (postings.length ? postings[Math.floor(day.getTime() / 86400000) % postings.length] : null);
