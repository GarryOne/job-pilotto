// The shadow question's agree / better / worse table (spec docs/superpowers/specs/2026-10-12-one-next-move.md, switch-on criteria per dead end): every real stop of a pool row ("dead end: <why>", the
// door's id in its fields) joined by that id to the question the fallback asked at it ("dead end fallback (shadow)", the same `door`), and judged from the row's REAL ending, never by hand:
//   not_asked  the question did not run (the digest was asked already, the page moved on, or the line is missing)
//   agree      the fallback would not act (a person is needed, the way is not listed, unsure, a floor refused, one ask, two asks disagreed): it says what the stop said
//   better     the fallback would act (sure, past the floors, two agreeing asks) where the stop was unresolved: a move the stop did not make; a candidate until the CI pool acts (box 8)
//   worse      the fallback would act where the stop handed the page to the person (ending handed): acting there would be wrong; any such row blocks the switch-on
// Silent stops (shadow notices, `shadow: true` on the stop line itself) are counted apart: the question is not asked at them. Pure: the caller reads the logs (pool-shadow.mjs). Guard: e2e/test/pool-shadow.test.mjs.
const STOP = /^(\S+Z) \[extension\] fill: dead end: ([a-z_-]+) (\{.*\})\s*$/;
const ASKED = /^(\S+Z) \[extension\] fill: dead end fallback \(shadow\)(?:: ([a-z ]+))? (\{.*\})\s*$/;
const parsed = text => { try { return JSON.parse(text); } catch { return {}; } };

// appLog -> [{door, why, ending, host, asked: 'fields' | 'asked already' | 'the page moved on' | '', actWhy, wouldAct, agree, confidence, verb, number, usd}], one per real stop, in log order
export function stopsOf(appLog = '') {
  const stops = [], asks = new Map();
  for (const text of String(appLog).split('\n')) {
    const stop = STOP.exec(text), ask = ASKED.exec(text);
    if (stop) { const fields = parsed(stop[3]); if (fields.shadow !== true) stops.push({door: fields.door, why: stop[2], ending: fields.ending || '', host: fields.host || ''}); }
    else if (ask) { const fields = parsed(ask[3]); if (Number.isInteger(fields.door)) asks.set(fields.door, {note: ask[2] || '', fields}); }
  }
  return stops.map(stop => {
    const ask = asks.get(stop.door), fields = ask?.fields || {};
    const asked = !ask ? 'missing' : ask.note ? ask.note : 'asked';
    return {...stop, asked, actWhy: fields.actWhy || '', wouldAct: fields.wouldAct === true, agree: fields.agree, confidence: fields.confidence ?? -1, verb: fields.verb || '', number: fields.number ?? -1, usd: Number(fields.usd) || 0};
  });
}

// One stop -> 'not_asked' | 'agree' | 'better' | 'worse'
export function verdictOf(stop) {
  if (stop.asked !== 'asked') return 'not_asked';
  if (!stop.wouldAct) return 'agree';
  return stop.ending === 'handed' ? 'worse' : 'better';
}

// rows: [{row, log}] -> {byWhy: {why: {agree, better, worse, not_asked}}, total, worse: [{row, door, why}], better: [...], usd}
export function shadowTable(rows = []) {
  const byWhy = {}, worse = [], better = [];
  let total = 0, usd = 0;
  for (const {row, log} of rows) for (const stop of stopsOf(log)) {
    const verdict = verdictOf(stop), entry = byWhy[stop.why] ||= {agree: 0, better: 0, worse: 0, not_asked: 0};
    entry[verdict]++; total++; usd += stop.usd;
    if (verdict === 'worse') worse.push({row, door: stop.door, why: stop.why});
    if (verdict === 'better') better.push({row, door: stop.door, why: stop.why});
  }
  return {byWhy, total, worse, better, usd: Math.round(usd * 1e6) / 1e6};
}
