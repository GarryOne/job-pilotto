// Layer 3 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): the nightly live smoke's logic, no browser here.
// parseLive reads where a live run got to from its own printed log lines (lib/apply-live.mjs), compare finds what reached less than last time, pickPosting
// rotates through the owner's postings of each site shape. Runner: e2e/smoke.mjs. Guard: e2e/test/smoke.test.mjs.
export const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];
// Sites read only through the person's own visit, never by an automated run (CLAUDE.md: LinkedIn, Glassdoor, Indeed, levels.fyi and Reddit; 10 Oct 2026: discovery
// opened an Indeed posting). Never a smoke or discovery candidate, whatever list it comes from.
export const NEVER_VISIT = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;
export const mayVisit = url => { try { return !NEVER_VISIT.test(new URL(url).hostname); } catch { return true; } };   // only the named sites are blocked
const rank = step => STEPS.indexOf(step);

// -> {reached, filled, left, kinds: [page kinds seen], path: [{kind, host}] in order (consecutive repeats folded), errors: [lines]}
export function parseLive(output) {
  const lines = String(output || '').split('\n');
  let reached = 'none', filled = null, left = null;
  const kinds = [], errors = [], path = [];
  const reach = step => { if (rank(step) > rank(reached)) reached = step; };
  for (const line of lines) {
    if (/Apply pressed on /.test(line)) reach('posting');
    const kind = line.match(/page kind: ([\w-]+)/);
    if (kind) { const host = (line.match(/"host":"([^"]+)"/) || line.match(/"shape":"([^\/"|]+)/) || [])[1] || ''; const last = path.at(-1);
      if (!last || last.kind !== kind[1] || last.host !== host) path.push({kind: kind[1], host});
      kinds.push(kind[1]); if (kind[1] === 'account') reach('account'); if (/^(form|account-form)$/.test(kind[1])) reach('form'); }
    if (/account (judgment|result)[^:]*: needs_code|"botCheck":true|bot check/.test(line)) reach('code/bot');
    const fields = line.match(/fields: (\d+) filled, (\d+) left/);
    if (fields && !/account page/.test(line)) { filled = Number(fields[1]); left = Number(fields[2]); reach('form'); if (left === 0 && filled > 0) reach('ready'); }
    if (/(^|\s)(✗|not ok)\b|Error:|crash/.test(line)) errors.push(line.trim().slice(0, 200));
  }
  return {reached, filled, left, kinds: [...new Set(kinds)], path, errors};
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
export const pickPosting = (postings, day = new Date()) => { const allowed = postings.filter(item => mayVisit(item?.url || item)); return allowed.length ? allowed[Math.floor(day.getTime() / 86400000) % allowed.length] : null; };

// Tonight's share of a big pool (owner, 10 Oct 2026: "100 sites, 10 a night, all of them in 10 days"): a window that moves by perNight each day, wrapping.
export function tonight(shapes, perNight = 10, day = new Date()) {
  if (!shapes.length || perNight >= shapes.length) return shapes;
  const start = (Math.floor(day.getTime() / 86400000) * perNight) % shapes.length;
  return Array.from({length: perNight}, (_, i) => shapes[(start + i) % shapes.length]);
}

// Each shape's most recent result across all earlier reports (a shape runs every few nights, so its "last time" may be days ago).
export function lastSeen(reports) {
  const seen = {};
  for (const report of [...reports].sort((a, b) => String(a.day).localeCompare(String(b.day)))) for (const [shape, result] of Object.entries(report.results || {})) seen[shape] = {...result, day: report.day};
  return seen;
}

// A site's flow signature (owner, 10 Oct 2026: tell distinct flows apart by what the extension met, not by the address): the page kinds in order, with the
// host where the journey ended, and how far it got. Two sites with one signature test the same thing; a new signature is a new shape for the pool.
export function signature(result) {
  const path = (result?.path || []).filter(step => step.kind);
  if (!path.length) return 'unclear';   // no page kind was decided: nothing learned about the site's flow (10 Oct 2026: Richemont's first run)
  return `${path.map(step => step.kind).join('>')}@${path.at(-1).host || '?'}#${result.reached}`;
}
// Discovery candidates from a job list: a few postings per host (more from job boards, whose postings lead to different employers), none already in the pool.
export function candidates(postings, known = new Set(), {perHost = 2, perBoard = 12, boards = /(^|\.)(jobs\.ch|jobup\.ch|indeed\.|arbeitnow\.ch|linkedin\.)/} = {}) {
  const byHost = {};
  for (const posting of postings) {
    if (known.has(posting.url) || !mayVisit(posting.url)) continue;
    let host = ''; try { host = new URL(posting.url).hostname; } catch { continue; }
    (byHost[host] ||= []).push(posting);
  }
  return Object.entries(byHost).flatMap(([host, list]) => list.slice(0, boards.test(host) ? perBoard : perHost));
}
