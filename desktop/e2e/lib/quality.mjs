// Pure checks on what the Jobs check produced, against the ground truth of the golden postings (fixtures/golden/truth.json). No app, no network: every check is
// unit-tested against a deliberately wrong input (test/quality.test.mjs), so a check that cannot fail cannot hide in the suite.

const digits = text => String(text || '').replace(/[^0-9]/g, ' ').split(/\s+/).filter(Boolean);

// Same posting, same URL once tracking parameters are gone (the app's own rule lives in src/notion/dedupe.py).
export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|ref$|source$|gh_src$|lever-)/i.test(key)) parsed.searchParams.delete(key);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch { return String(url || '').trim(); }
}

// Which Notion row is which posting: by the posting's URL (tracking parameters ignored). -> {byId: {id: [rows]}, strays: [rows no posting explains]}
export function matchRows(truth, rows) {
  const byUrl = new Map(truth.filter(item => !item.duplicateOf).map(item => [normalizeUrl(item.url), item.id]));
  const byId = {}, strays = [];
  for (const row of rows) {
    const id = byUrl.get(normalizeUrl(row.props['Job URL']));
    if (id == null) strays.push(row); else (byId[id] ||= []).push(row);
  }
  return {byId, strays};
}

// The enriched facts of one row against its posting's truth. -> [{posting, fact, expected, actual, ok}]; a truth field that is null is not checked.
export function checkFacts(item, row) {
  const p = row.props, checks = [];
  const add = (fact, expected, actual, ok) => checks.push({posting: item.title, fact, expected, actual, ok});
  if (item.seniority != null) add('seniority', item.seniority, p.Seniority ?? null, p.Seniority === item.seniority);
  if (item.workMode != null) add('work mode', item.workMode, p['Work mode'] ?? null, p['Work mode'] === item.workMode);
  add('location', item.location, p.Location, p.Location === item.location);
  if (item.english != null) add('English is enough', item.english, (p.Languages || []).includes('English'), (p.Languages || []).includes('English') === item.english);
  if (item.languagePlus != null) {
    const plus = (p.Languages || []).filter(name => name.endsWith(' +')).sort();
    add('languages that are a plus', item.languagePlus, plus, JSON.stringify(plus) === JSON.stringify([...item.languagePlus].sort()));
  }
  if (item.salary != null) {
    const shown = digits(String(p.Salary || '').replace(/(\d)[,'’.](?=\d{3}\b)/g, '$1'));
    const ok = item.salary === '' ? !String(p.Salary || '').trim() : item.salary.every(figure => shown.includes(figure));
    add('salary', item.salary === '' ? '(none stated: empty)' : item.salary.join('–'), p.Salary || '(empty)', ok);
  }
  if (item.mustMention) {   // a blocker the posting states must be named where the person reads why the score is what it is
    const said = [p.Reason, p.Gaps].filter(Boolean).join(' / ');
    add('says why (reason or gaps)', `mentions /${item.mustMention}/`, said || '(empty)', new RegExp(item.mustMention, 'i').test(said));
  }
  if (item.roleFamily != null) add('role family', item.roleFamily.join('|'), p['Role family'] ?? null, item.roleFamily.includes(p['Role family']));
  return checks;
}

// Every column the app promises for a scored job. -> the missing ones.
export const REQUIRED_COLUMNS = ['Job', 'Score', 'Tier', 'Company', 'Location', 'Reason', 'Role fit', 'Location fit', 'Compensation fit', 'Growth', 'Risk', 'Confidence', 'Job URL', 'Code', 'Status',
  'Seniority', 'Work mode', 'Languages', 'Technologies'];
// `mayBeEmpty`: the columns this posting does not state a value for (the truth names them), which the app rightly leaves empty.
export function missingColumns(row, mayBeEmpty = []) {
  return REQUIRED_COLUMNS.filter(name => !mayBeEmpty.includes(name)).filter(name => {
    const value = row.props[name];
    return value == null || value === '' || (Array.isArray(value) && value.length === 0 && name !== 'Languages');
  });
}

// Ranking: every posting that should rank high scores above every one that should not. -> [{high, low, highScore, lowScore}] of the violations.
export function rankingViolations(truth, scores) {
  const of = fit => truth.filter(item => item.fit === fit && scores[item.id] != null);
  const violations = [];
  for (const high of of('high')) for (const low of of('low')) if (!(scores[high.id] > scores[low.id])) violations.push({high: high.title, low: low.title, highScore: scores[high.id], lowScore: scores[low.id]});
  return violations;
}

// Two scorings of the same postings: the ones further apart than `tolerance`. -> [{id, first, second}]
export function unstable(first, second, tolerance = 8) {
  return Object.keys(first).filter(id => second[id] != null && Math.abs(first[id] - second[id]) > tolerance).map(id => ({id, first: first[id], second: second[id]}));
}

// Text a person reads (or Notion stores) must never show a programming accident.
const DIRTY = [[/\bundefined\b/i, 'undefined'], [/\bnull\b/i, 'null'], [/\[object \w+\]/i, '[object Object]'], [/\bNaN\b/, 'NaN'], [/^\s*[{\[]\s*"[\w-]+"\s*:/m, 'raw JSON'], [/^\s*\{\{|\}\}\s*$|\$\{/m, 'template placeholder']];
export function dirtyText(text) {
  return DIRTY.filter(([pattern]) => pattern.test(String(text ?? ''))).map(([, name]) => name);
}

// The text columns of rows (what is stored in Notion) that carry a programming accident. -> [{where, problems}]
export function dirtyRows(rows) {
  const found = [];
  for (const row of rows) for (const [column, value] of Object.entries(row.props)) {
    const text = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
    const problems = dirtyText(text);
    if (problems.length) found.push({where: `${row.props.Job || row.id} / ${column}`, problems});
  }
  return found;
}

// Which of the given secrets or posting texts appear in a log. Needles shorter than 12 characters are refused (they would match anything).
export function leaks(logText, needles) {
  const bad = needles.filter(needle => String(needle).trim().length < 12);
  if (bad.length) throw new Error(`leak needles must be at least 12 characters: ${bad.join(', ')}`);
  const haystack = String(logText).replace(/\s+/g, ' ');
  return needles.filter(needle => haystack.includes(String(needle).replace(/\s+/g, ' ')));
}

// Distinctive stretches of a text (a posting's description, a CV): 40 characters from its start, middle and end, no newlines.
export function fingerprints(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (flat.length < 40) return [];
  return [0, Math.floor((flat.length - 40) / 2), flat.length - 40].map(start => flat.slice(start, start + 40));
}

// Model noise. The scorer and the judge are language models: one text in nine may be a slip, and one job in nine may land more than the tolerance away on a second
// scoring. More than that is a quality problem. A single job that moves further than HARD_JUMP is a problem on its own. Facts, duplicates, ranking and leaks have no allowance.
export const NOISE_SHARE = 0.12;
export const HARD_JUMP = 20;
export const allowedMisses = total => Math.floor(total * NOISE_SHARE);   // 9 -> 1, 8 -> 0, 17 -> 2

// -> {ok, allowed, problems}: `apart` is unstable()'s answer for `compared` jobs.
export function stabilityVerdict(apart, compared) {
  const allowed = allowedMisses(compared);
  const jumps = apart.filter(item => Math.abs(item.first - item.second) > HARD_JUMP);
  const problems = [...(apart.length > allowed ? [`${apart.length} of ${compared} jobs moved more than the tolerance (at most ${allowed} allowed)`] : []),
    ...jumps.map(item => `job ${item.id} moved ${Math.abs(item.first - item.second)} points (${item.first} → ${item.second}), more than ${HARD_JUMP}`)];
  return {ok: !problems.length, allowed, problems};
}

// -> {ok, allowed, tolerated}: `failed` are the judged texts that invent facts or contradict the posting, out of `judged`.
export function judgeVerdict(failed, judged) {
  const allowed = allowedMisses(judged);
  return {ok: failed.length <= allowed, allowed, tolerated: failed.length <= allowed ? failed : []};
}
