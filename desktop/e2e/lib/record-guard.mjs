// The recording-side guards (owner, 15 Oct 2026, after 7 rows were lost while every check stayed green): what records-publish.mjs refuses to put on the release. Each refusal
// prints why and what to run. Per record, on its own: its page text decodes cleanly (no UTF-8 read as Latin-1), it carries the live run's kept answers, and its own replay reaches
// the step live reached. Against the record it replaces: it must reach at least that one's step or outcome, and a PINNED row (replay-faithful.json) must replay same as live
// before it replaces anything. Only the owner's "<row> — <reason>" (passed as --accept) overrides, for that row only (the replay-accepts.mjs format; never posted by a session).
// The mojibake definition is a6's (15 Oct 2026, the charset fix in net-keep.js): text with only chars <= U+00FF, some >= U+0080, whose Latin-1 bytes are valid UTF-8; never a grep for "Ã".
// Pure but for the two folder readers; the replays are run by records-publish.mjs and passed in. Guard: e2e/test/record-guard.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {isSame} from '../replay-records.mjs';
import {acceptNamed} from '../replay-accepts.mjs';
import {rank} from './smoke.mjs';

const strict = new TextDecoder('utf-8', {fatal: true});

// text -> true when it is the Latin-1 image of valid UTF-8 (a double-encoded page).
export function latin1Image(text) {
  let high = false;
  for (let at = 0; at < text.length; at += 1) { const code = text.charCodeAt(at); if (code > 0xff) return false; if (code >= 0x80) high = true; }
  if (!high) return false;
  try { strict.decode(Buffer.from(text, 'latin1')); return true; } catch { return false; }
}

// A record folder -> the kept bodies (hash names) whose text is double-encoded. Binary bodies (not valid UTF-8 as a whole, or with NUL) are not text and are skipped.
export function mojibakeBodies(dir) {
  const folder = path.join(dir, 'bodies');
  if (!fs.existsSync(folder)) return [];
  const bad = [];
  for (const hash of fs.readdirSync(folder)) {
    const bytes = fs.readFileSync(path.join(folder, hash));
    if (bytes.includes(0)) continue;
    let text; try { text = strict.decode(bytes); } catch { continue; }
    if (latin1Image(text)) bad.push(hash);
  }
  return bad;
}

// A record folder -> '' or why its kept answers are missing: the live run asked (asks.jsonl has lines) but model-memo.json has no answers.
export function memoProblem(dir) {
  const read = name => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } };
  const asked = read('asks.jsonl').split('\n').filter(Boolean).length;
  let kept = 0;
  try { const memo = JSON.parse(read('model-memo.json') || '{}'); kept = Array.isArray(memo) ? memo.length : Object.keys(memo.entries || memo.answers || memo).length; } catch { return 'model-memo.json does not parse'; }
  if (!read('model-memo.json')) return asked ? `the live run asked ${asked} time(s) but model-memo.json is missing` : '';
  return asked && !kept ? `the live run asked ${asked} time(s) but model-memo.json keeps no answer` : '';
}

// (the live outcome of the new record's replay, of the replaced one's) -> '' or why the new one is worse: a lower step, or the same step with fewer boxes filled.
export function notWorse(now, old) {
  if (!now || !old) return '';
  if (rank(now.reached) < rank(old.reached)) return `reaches ${now.reached}, the record it replaces reaches ${old.reached}`;
  if (rank(now.reached) === rank(old.reached) && old.filled != null && now.filled != null && now.filled < old.filled) return `fills ${now.filled}, the record it replaces fills ${old.filled}`;
  return '';
}

const RUN = (name, why) => `node records-publish.mjs <dir with only this row> --accept "${name} — <reason>" (the owner's word only), or re-record it: ${why}`;

// (items: [{name, dir, replay, replaced}], {pins, accepts: ['<row> — <reason>']}) -> {refusals: [{row, check, why, run}], notes: [text]}.
// replay: this record's own replay result (replay-records fidelity record: outcome, liveOutcome, live, network) or null when none ran;
// replaced: the replay result of the record it would replace, or undefined when there is none to compare with.
export function judgeRecords(items, {pins = [], accepts = []} = {}) {
  const refusals = [], notes = [], names = items.map(item => item.name), entries = accepts.map(text => ({pr: 'owner', text}));
  for (const {name, dir, replay, replaced} of items) {
    const add = (check, why, run = '') => refusals.push({row: name, check, why, run});
    const bad = mojibakeBodies(dir);
    if (bad.length) add('text', `${bad.length} kept page(s) are double-encoded (UTF-8 read as Latin-1, e.g. ${bad[0].slice(0, 10)}…)`, 'fix the charset at record time (net-keep.js) and re-record this row');
    const memo = memoProblem(dir);
    if (memo) add('answers', memo, 're-record this row: the live run\'s kept answers must travel with it');
    const accepted = acceptNamed(name, entries, names);   // the owner's named word: it lifts the pinned and worse refusals of this row (acceptedFor), nothing else
    if (!replay) { add('replay', 'its own replay did not run, so nothing proves it reaches the step live reached', 'run it again on the Mac (up to 3 rows at a time)'); continue; }
    const live = replay.liveOutcome, now = replay.outcome;
    if (live && now && rank(now.reached) < rank(live.reached)) add('step', `its replay reaches ${now.reached}, live reached ${live.reached}`, RUN(name, 'the replay must reach the live step'));
    if (pins.includes(name) && !isSame(replay)) add('pinned', `a pinned row must replay same as live before it replaces its record (asks answered ${replay.network?.hit ?? 0}/${replay.live?.asks ?? '?'}, ${replay.network?.extra ?? '?'} extra)`, RUN(name, 'fill-memo, or a better recording'));
    if (replaced === undefined) { if (pins.includes(name)) add('worse', 'the record it replaces was not given, so "not worse" cannot be shown', 'pass --against <dir of the released records> (net-records-fetch.sh)'); else notes.push(`${name}: not compared with the record it replaces (none given)`); continue; }
    const worse = notWorse(replay.liveOutcome, replaced?.liveOutcome);
    if (worse) add('worse', `it ${worse}`, RUN(name, 'a record may not replace a better one'));
    if (accepted && refusals.some(one => one.row === name && ['pinned', 'worse'].includes(one.check))) notes.push(`${name}: its pinned/worse refusal is accepted by the owner (${accepted.reason || 'no reason given'})`);
  }
  return {refusals: refusals.filter(one => !acceptedFor(one, entries, names)), notes};
}

// The owner's named accept covers the pinned and worse checks of that row, never a double-encoded page or missing answers (those cannot be intended).
const acceptedFor = (refusal, entries, names) => ['pinned', 'worse'].includes(refusal.check) && !!acceptNamed(refusal.row, entries, names);

export const report = ({refusals, notes}) => [...refusals.map(one => `refused: ${one.row}: ${one.check}: ${one.why}\n  to proceed: ${one.run}`), ...notes.map(text => `note: ${text}`)].join('\n');
