// Layer 3 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): the nightly live smoke's logic, no browser here.
// parseLive reads where a live run got to from its own printed log lines (lib/apply-live.mjs), compare finds what reached less than last time, pickPosting
// rotates through the owner's postings of each site shape. Runner: e2e/smoke.mjs. Guard: e2e/test/smoke.test.mjs.
import {causeOf} from '../../../extension/fill-card.js';
export const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];
// Sites read only through the person's own visit, never by an automated run (CLAUDE.md: LinkedIn, Glassdoor, Indeed, levels.fyi and Reddit; 10 Oct 2026: discovery
// opened an Indeed posting). Never a smoke or discovery candidate, whatever list it comes from.
export const NEVER_VISIT = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;
export const mayVisit = url => { try { return !NEVER_VISIT.test(new URL(url).hostname); } catch { return true; } };   // only the named sites are blocked
const rank = step => STEPS.indexOf(step);

// The AI ladder's rung (0 to 6) of a decision, read from the app's own log lines (docs/flows/ladder.md); the app's exact line `ladder: rung N signal S` overrides what is derived.
const BY_RUNG = {ai: 2, remembered: 1, 'structure rule': 0};
const SIGNALS = ['unsure', 'contradicted', 'stalled', 'failed'];

// The rung and signal a site's upload row carries (absent = unknown; the site drops anything else).
export const rungFields = result => ({...(result?.rung != null ? {rung: result.rung} : {}), ...(result?.signal ? {signal: result.signal} : {})});

// -> {reached, filled, left, rung (0-6 | null), signal (unsure|contradicted|stalled|failed | null), kinds: [page kinds seen], path: [{kind, host}] in order (consecutive repeats folded), errors: [lines]}
export function parseLive(output) {
  const lines = String(output || '').split('\n');
  let reached = 'none', filled = null, left = null, marks = null;
  const kinds = [], errors = [], path = [];
  let fieldList = [];   // the form's fields, one 'field ...' line each (apply-live.mjs prints them whole: the app's own line is cut at 230 characters)
  let derived = null, told = null;
  const pageKindErrors = [];   // the AI's own words when a page-kind answer had no kind (usage limit, CLI failure...): job-pilotto-54 found a fast null answer with nothing saying why
  const reach = step => { if (rank(step) > rank(reached)) reached = step; };
  for (const line of lines) {
    if (/Apply pressed on /.test(line)) reach('posting');
    const kind = line.match(/page kind: ([\w-]+)/);
    if (kind) { const host = (line.match(/"host":"([^"]+)"/) || line.match(/"shape":"([^\/"|]+)/) || [])[1] || ''; const last = path.at(-1);
      if (!last || last.kind !== kind[1] || last.host !== host) path.push({kind: kind[1], host});
      const by = (line.match(/"by":"([^"]*)"/) || [])[1];
      derived = BY_RUNG[by] ?? (/page kind: none/.test(line) ? 0 : derived);
      kinds.push(kind[1]); if (kind[1] === 'account') reach('account'); if (/^(form|account-form)$/.test(kind[1])) reach('form'); }
    if (/account (judgment|result)[^:]*: needs_code|"botCheck":true|bot check/.test(line)) reach('code/bot');
    const noKind = line.match(/page kind: none \(([^)]*)\)/);
    if (noKind && noKind[1] && !pageKindErrors.includes(noKind[1].slice(0, 120)) && pageKindErrors.length < 5) pageKindErrors.push(noKind[1].slice(0, 120));
    if (/pressed the control the digest named|the page tells what to do/.test(line)) derived = 3;   // the ladder's rung 3 (the numbered digest) decided
    if (/\bcloser look: /.test(line)) derived = 4;
    if (/the ladder ended at the person/.test(line)) derived = 6;
    if (/take over with Claude asked from the page/.test(line)) derived = 5;
    const ladder = line.match(/\bladder: rung (\d) signal (\w+)\s*$/);
    if (ladder && Number(ladder[1]) <= 6) told = {rung: Number(ladder[1]), signal: SIGNALS.includes(ladder[2]) ? ladder[2] : null};
    const markLine = line.match(/fill: marks: (\d+) starred, (\d+) required/);
    if (markLine && !/account page/.test(line)) marks = {starred: Number(markLine[1]), required: Number(markLine[2])};
    const fields = line.match(/fields: (\d+) filled, (\d+) left/);
    const field = line.match(/^\s+field (filled|left) (\S+) "(.*)" required=(true|false|\?) reason=(.*)$/);
    if (field) fieldList.push({outcome: field[1], type: field[2], label: field[3], required: field[4] === 'true' ? true : field[4] === 'false' ? false : null, reason: field[5]});
    if (fields && !/account page/.test(line)) { fieldList = []; filled = Number(fields[1]); left = Number(fields[2]); reach('form'); if (left === 0 && filled > 0) reach('ready'); }
    if (/(^|\s)(✗|not ok)\b|Error:|crash/.test(line)) errors.push(line.trim().slice(0, 200));
  }
  return {reached, filled, left, rung: told ? told.rung : derived, signal: told ? told.signal : null, fieldList, marks, pageKindErrors, kinds: [...new Set(kinds)], path, errors};
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

// Where a discovered flow goes in this Mac's list: a never-run shape on the posting's own host gets the signature (no duplicate row), else a new shape named
// by the employer ("Breitling (found 2026-10-10)"; the host's name when the list has no company). Returns the shape touched.
export function placeFound(shapes, posting, flow, day) {
  const host = url => { try { return new URL(url).hostname; } catch { return ''; } };
  const own = shapes.find(item => !item.signature && (item.urls || []).some(url => host(url) === host(posting.url)));
  if (own) { own.signature = flow; return own; }
  const added = {shape: `${posting.company || host(posting.url)} (found ${day})`, urls: [posting.url], signature: flow};
  shapes.push(added);
  return added;
}

// The "*" cross-check for one run (the same rule as site/src/formlearning.js marksCheck): the page marked at least 3 labels and the extension counted
// fewer than half as many required questions, so its required rule missed a layout. {starred, required} or null.
export function marksBlind(result) {
  const marks = result?.marks;
  return marks && marks.starred >= 3 && marks.starred > 2 * marks.required ? marks : null;
}

// The owner's test for a left field (10 Oct 2026, after "4 of 12" for a form whose left fields were all questions only the person can answer): (1) did we really not know the answer
// (the kit, the Profile, the person's details were checked), and (2) did we suggest one? Both yes: expected, however little is filled. Else a failure. The reasons are the extension's own fixed
// texts and its own cause words (extension/fill-card.js causeOf), never a word list of ours.
//   filled       the extension filled it
//   expected     a suggestion was shown for the person to confirm, or it is a legal / consent choice (always the person's)
//   miss         the extension had it or failed to apply it: the field did not take it, the question text was not read, a menu did not open or select
//   no_suggestion  nothing known and nothing proposed (the AI declined, was unsure or was not asked)
//   unknown      the same, but the AI was off in this run (an AuthenticationError in the log): no suggestion could exist, so it is not judged
export function verdictOf(field, {aiOff = false} = {}) {
  if (field.outcome === 'filled') return 'filled';
  const reason = String(field.reason || '');
  if (/^legal/.test(reason)) return 'expected';
  const cause = causeOf({reason, field: field.label});
  if (cause === 'proposed') return 'expected';
  if (['no_data', 'ai_declined', 'ai_unsure', 'ai_off', 'ai_error'].includes(cause)) return aiOff ? 'unknown' : 'no_suggestion';
  return 'miss';
}

// A shortfall: the form was reached and at least one asked field (a required one, not a file slot) is a miss or has no suggestion. With no field list (an old run) the counts decide:
// under half filled. Returns {done, total, miss, noSuggestion} or null.
export function shortfall(result, {aiOff = result?.aiOff} = {}) {
  if (result?.reached !== 'form' || result.filled == null) return null;
  const list = (result.fieldList || []).filter(item => item.required !== false && item.type !== 'file');
  if (!list.length) {
    const total = result.filled + (result.left || 0);
    return total > 0 && result.filled / total < 0.5 ? {done: result.filled, total, miss: 0, noSuggestion: 0} : null;
  }
  const verdicts = list.map(item => verdictOf(item, {aiOff}));
  const miss = verdicts.filter(item => item === 'miss').length, noSuggestion = verdicts.filter(item => item === 'no_suggestion').length;
  return miss + noSuggestion > 0 ? {done: verdicts.filter(item => item === 'filled' || item === 'expected').length, total: list.length, miss, noSuggestion} : null;
}

// The one-per-field lines for the app's "fill: fields: N filled, M left {...}" log line (the app's line is cut at 230 characters in the run's timeline, so a run lost which fields were left and why);
// parseLive reads them back. An account page's fields are not the form's, and a line that is not whole JSON gives none.
export function fieldLines(line) {
  const at = String(line).indexOf('{"fields":');
  if (at < 0 || !/fill: fields: \d+ filled/.test(line) || /account page/.test(line)) return [];
  try {
    return JSON.parse(line.slice(at, line.lastIndexOf('}') + 1)).fields.slice(0, 40).map(item => `      field ${item.outcome} ${item.type} "${String(item.label || '').replace(/\s+/g, ' ').slice(0, 60)}" required=${item.required === undefined ? '?' : item.required} reason=${String(item.reason || item.source || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch { return []; }
}

// What the page needs of the verdict (site/src/applying.js shortOf): the asked fields and how many are unexplained, only for a form reached with a field list; an older run sends nothing and the page counts.
export function verdictFields(result) {
  if (result?.reached !== 'form' || !(result.fieldList || []).length) return {};
  const asked = result.fieldList.filter(item => item.required !== false && item.type !== 'file').length, short = shortfall(result);
  return {asked, unexplained: short ? short.miss + short.noSuggestion : 0};
}
