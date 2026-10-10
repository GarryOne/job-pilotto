// Where an application stands, owned in ONE place (spec: docs/superpowers/specs/2026-10-10-application-journey.md). A pure reducer: a session's
// journey fields and one event in, the fields to change out. terminals.js applies the result (noteStuck, clearStuck, setStage, setAccount call it);
// nothing else writes these fields. Screens read them (renderer/session-state.js) and `journeyStep` names the one step they add up to.
// Guards: test/application-journey.test.js (each invariant), test/journeys.test.js (the scenarios of docs/flows/applying.md as event sequences).
//
// Invariants (each has a test; change one only with the owner, and say so in the commit):
//  1. A finished application (outcome set) never changes step.
//  2. 'no-form' never lands on an application already at the account step: the report came from a tab it has left (the posting behind its
//     sign-in tab); the card must not say "can't reach the form" over a sign-in page (10 Oct 2026).
//  3. Once stuck at the account step, only a new need changes it; a later 'no-form' or 'incomplete' does not.
//  4. 'incomplete' (a fill that put nothing in) is cleared only by clearStuck, which session-flow.js calls when something is filled (c1a2fcc).
//  6. The account record (accountTerms: at most 3 terms the extension accepted, once each; accountCode: a code from the mail was typed) only grows, from fixed facts, on a running application (10 Oct 2026).
//  5. Fields come from fixed values: stuck in STUCK, stage in STAGES, accountState in ACCOUNT_STATES, accountStep in ACCOUNT_STEPS; a need is a label of at most 80 characters.

export const STUCK = ['account', 'incomplete', 'no-form'];
export const STAGES = ['account', 'form'];
export const ACCOUNT_STATES = ['created', 'confirm', 'exists', 'refused'];
export const ACCOUNT_STEPS = ['sign_in', 'sign_up'];
export const STEPS = ['posting', 'account', 'confirm', 'form', 'ended'];

const label = needs => String(needs || '').replace(/\s+/g, ' ').trim().slice(0, 80);
const noteFor = (why, need) => (need ? `Needs you: ${need}` : why === 'account' ? 'This site needs an account' : 'The extension can\'t reach the form');

// -> {set: {field: value} to apply (empty: nothing changed), result: what the old terminals function returned}.
export function journey(session, event) {
  const none = {set: {}, result: false};
  if (!session) return none;
  if (event.type === 'clear-stuck') {   // no outcome guard: a submitted form that was stuck still loses its stale "needs you"
    return session.stuck ? {set: {stuck: '', accountNeeds: '', note: 'Form open in Chrome'}, result: true} : none;
  }
  if (session.outcome) return none;   // invariant 1
  if (event.type === 'stage') {
    const stage = STAGES.includes(event.stage) ? event.stage : '';
    if (!stage || (session.stage === stage && (!event.host || session.accountHost === event.host))) return none;
    return {set: {stage, ...(stage === 'account' && event.host ? {accountHost: event.host} : {})}, result: true};
  }
  if (event.type === 'account') {
    if (!ACCOUNT_STATES.includes(event.state) || session.accountState === event.state) return none;
    return {set: {accountState: event.state}, result: true};
  }
  if (event.type === 'account-fact') {   // invariant 6: what the extension did on the account page, kept as the card's record
    if (event.fact === 'code') return session.accountCode ? none : {set: {accountCode: true}, result: true};
    const text = event.fact === 'terms' ? label(event.text) : '';
    const have = Array.isArray(session.accountTerms) ? session.accountTerms : [];
    return !text || have.includes(text) || have.length >= 3 ? none : {set: {accountTerms: [...have, text]}, result: true};
  }
  if (event.type === 'stuck') {
    if (session.kind !== 'form' || !STUCK.includes(event.why)) return none;
    const why = event.why, need = label(event.needs), note = noteFor(why, need), set = {};
    const step = ACCOUNT_STEPS.includes(event.accountStep) ? event.accountStep : '';   // the AI's page type: only these two change the wording
    if (why === 'account' && step && session.accountStep !== step) set.accountStep = step;
    if (why === 'no-form' && (session.stage === 'account' || session.stuck === 'account')) return {set, result: false};   // invariants 2, 3
    if (session.stuck === why) {   // reported again: only a new need changes anything
      if (!need || session.note === note) return {set, result: false};
      return {set: {...set, note, accountNeeds: need}, result: true};
    }
    if (session.stuck === 'account') return {set, result: false};   // invariant 3
    Object.assign(set, {stuck: why, note});
    if (why === 'account') Object.assign(set, {stage: 'account', accountHost: event.host || session.accountHost || ''});
    if (why === 'account' || why === 'incomplete') set.accountNeeds = need;
    return {set, result: true};
  }
  return none;
}

// The one step the fields add up to (what a card leads with); `needs` is what only the person can do now.
export function journeyStep(session) {
  if (!session) return {step: 'posting', needs: ''};
  if (session.outcome) return {step: 'ended', needs: ''};
  const needs = session.accountNeeds || '';
  if (session.stage === 'form' && session.stuck !== 'account') return {step: 'form', needs: session.stuck === 'incomplete' ? needs : ''};
  if (session.accountState === 'confirm') return {step: 'confirm', needs};
  if (session.stage === 'account' || session.stuck === 'account' || session.accountState) return {step: 'account', needs};
  return {step: 'posting', needs: session.stuck === 'no-form' ? 'The extension can\'t reach the form' : ''};
}
