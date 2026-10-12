// The one question at each dead end, in SHADOW (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 4; owner, 13 Oct 2026: its spend OK, about $0.01 per pool
// pass). The door (dead-end.js deadEnd) hands each stop here once, after today's report: the numbered digest (rung 3) is asked what the next move is, the move it names is run
// through the live press path's floors WITHOUT pressing (apply-press.js wouldPress), and both are logged beside the stop with the door's id, so agree / better / worse is
// computed from the row's real ending (cc, 13 Oct 2026). Nothing acts: no press, no kept answer, no climb signal (askKind's shadow option). Fixed values only, never page text.
// Not asked again where the stop came from the digest itself (its next rung, the picture, is off), nor when the tab left the stop's page. Whether the move WOULD act is the one rule of
// ladder/next-move.js (box 5): a sure press past the floors is asked a second time, and acts only when both name the same control. Guard: worker/test/fallback.test.js.
import {mayAct, needsSecondAsk} from './next-move.js';

let ask = async () => null, floor = async () => ({press: false, why: null}), log = () => {};
// parts: {ask(tab, {digest, shadow}) (fill-flow.js askKind), floor(tabId, named) (apply-press.js wouldPress), log (the decide log)}; tests also pass {tab(tabId)}.
let tabOf = tabId => globalThis.chrome?.tabs?.get(tabId).catch(() => null) ?? Promise.resolve(null);
export function useFallback(parts = {}) {
  if (parts.ask) ask = parts.ask;
  if (parts.floor) floor = parts.floor;
  if (parts.log) log = parts.log;
  if (parts.tab) tabOf = parts.tab;
}

const WORD = /^[a-z_-]{1,24}$/;   // our own fixed words (a stop reason, an outcome, a verb): never page text
const word = value => (typeof value === 'string' && WORD.test(value) ? value : '');
const pageOf = url => String(url || '').split('#')[0];
// The live press path's refusal, as one fixed word (press-why.js flags): absent, behind a step (hidden), disabled, a Submit by another name, or another floor.
export const floorWord = why => (!why || !why.found ? 'absent' : !why.visible ? 'hidden' : !why.enabled ? 'disabled' : why.submits ? 'submits' : 'refused');

const asked = new Set();   // `${tabId} ${page}`: one question per page and tab
export const forgetFallback = tabId => { for (const key of [...asked]) if (key.startsWith(`${tabId} `)) asked.delete(key); };
globalThis.chrome?.tabs?.onRemoved?.addListener(forgetFallback);

// stop: {door (the door's id), tabId, page, why, rung (the rung that decided the stop, when known)}. -> the logged fields, or null when nothing was asked.
export async function askAtDeadEnd({door, tabId, page, why, rung} = {}) {
  const key = `${tabId} ${pageOf(page)}`;
  if (tabId == null || asked.has(key)) return null;
  asked.add(key);
  const base = {shadow: true, door, why: word(why)};
  if (rung === 3) { log('fill', 'dead end fallback (shadow): asked already', {...base, climb: 'picture_off'}); return null; }   // the digest decided this stop; rung 4 is off
  const tab = await tabOf(tabId);
  if (!tab || pageOf(tab.url) !== pageOf(page)) { log('fill', 'dead end fallback (shadow): the page moved on', base); return null; }
  const first = await moveOf(tab), second = needsSecondAsk(first) ? await moveOf(tab) : null;
  const decided = mayAct(first, second);
  const fields = {...base, ...first, usd: first.usd + (second?.usd || 0), ...(second ? {agree: decided.why !== 'disagree'} : {}), wouldAct: decided.act, actWhy: decided.why};
  log('fill', 'dead end fallback (shadow)', fields);
  return fields;
}

// One ask of the digest, its move and the floors the live path would apply: only a control the digest judged an Apply (applyButton, set by the app with press_kind), then the
// named-button finder's own floors. -> fixed values only.
async function moveOf(tab) {
  const answer = await ask(tab, {digest: true, shadow: true}).catch(() => null);
  const said = answer?.digestSaid || {};
  const press = ['press', 'open'].includes(said.verb);
  const check = !press ? {floor: 'none'} : !answer?.applyButton ? {floor: 'refused', floorWhy: 'not_apply'}
    : await floor(tab.id, answer.applyButton).then(found => (found?.press ? {floor: 'ok'} : {floor: 'refused', floorWhy: floorWord(found?.why)})).catch(() => ({floor: 'refused', floorWhy: 'unreadable'}));
  return {signal: word(answer?.signal) || 'none', outcome: word(said.outcome), verb: word(said.verb), number: Number.isInteger(said.numbers?.[0]) ? said.numbers[0] : -1,
    pressKind: word(said.pressKind), confidence: Number.isFinite(answer?.confidence) ? answer.confidence : -1, usd: Number.isFinite(answer?.usd) ? answer.usd : 0, ...check};
}
