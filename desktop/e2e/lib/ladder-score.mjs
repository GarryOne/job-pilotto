// Scores page-kind decisions against the ladder fixtures: each fixture's sketch goes through the REAL pageKind (desktop/lib/page-kind.js, the endpoint's sketchBody), with either the stored answer
// (offline: no model, what the push gate runs) or the real model on the plan path (live). Rates are per source, never one blended number. Used by: ladder-score.mjs, test/ladder-ratchet.test.js. Guard: test/ladder-score.test.js.
import {pageKind, sketchBody} from '../../lib/page-kind.js';

export const RANK = {exact: 0, ok: 1, miss: 2, 'wrong-confident': 3, 'no-answer': 4};   // higher is worse (the ratchet compares these)
export const SURE = 0.8;   // an answer at or above this that is wrong is "confidently wrong"
export const SOURCE_GROUP = {recorded: 'real', captured: 'real', reconstructed: 'reconstructed', invented: 'invented'};

// A pageKind result as the one outcome word the ladder speaks in. An unsure or failed answer is 'unsure': today it goes DOWN to the structure rule (spec gap 1).
export function outcomeOf(result = {}) {
  if (result.error) return 'unsure';
  if (result.kind === 'form' || result.kind === 'account-form') return 'form';
  if (result.kind === 'account') return 'account';
  if (result.kind === 'posting') return result.applyBy === 'email' ? 'email' : result.applyBy === 'other' ? 'other' : 'posting';
  return 'other';
}
// The rung that decides today: 0 the structure rule (no answer), 1 a kept answer, 2 the AI's text sketch.
export const rungOf = (result = {}) => (result.error ? 0 : result.by === 'remembered' ? 1 : 2);

export function statusOf(expect, outcome, confidence = 0) {
  if (outcome === expect.outcome) return 'exact';
  if ((expect.accept || []).includes(outcome)) return 'ok';
  return outcome !== 'unsure' && confidence >= SURE ? 'wrong-confident' : 'miss';
}

// A client that answers with a fixture's stored answer (the shape the Messages API gives), so the real pageKind runs unchanged.
const replayClient = answer => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 0, output_tokens: 0, billing: 'subscription'}, content: [{type: 'text', text: JSON.stringify(answer)}]})}});

// -> rows [{id, source, lang, trap, expected, outcome, confidence, rung, status, answer}]. `clientFor(fixture)` gives a live client; without it the stored answers are replayed.
export async function scoreFixtures(fixtures, {clientFor} = {}) {
  const rows = [];
  for (const fixture of fixtures) {
    const base = {id: fixture.id, source: fixture.source, lang: fixture.lang, trap: !!fixture.trap, expected: fixture.expect.outcome, accept: fixture.expect.accept || [fixture.expect.outcome], digest: fixture.expect.digest || '', wantRoute: fixture.expect.apply_route || ''};
    if (!clientFor && !fixture.answer) { rows.push({...base, outcome: '', confidence: 0, rung: -1, route: '', digestOk: null, status: 'no-answer'}); continue; }
    let captured = null;
    const client = clientFor ? clientFor(fixture) : replayClient(fixture.answer);
    const tee = {messages: {create: async body => { const response = await client.messages.create(body); try { captured = JSON.parse(response.content?.find(block => block.type === 'text')?.text || ''); } catch { /* not JSON: pageKind says so */ } return response; }}};
    const result = await pageKind(tee, sketchBody(fixture.sketch), null);
    const outcome = outcomeOf(result), confidence = Number(result.confidence ?? captured?.confidence) || 0;
    // A start dialog (expect.digest / expect.apply_route): the digest is NOT needed when rung 2 names the manual route and its listed button; the route it names is checked too.
    const route = result.applyRoute || '', button = result.applyButton || '', {digest, apply_route: wantRoute} = fixture.expect;
    const needsNoDigest = outcome === 'posting' && route === 'manual' && !!button;
    const digestOk = !digest && !wantRoute ? null : (digest === 'not_asked' ? needsNoDigest : digest === 'asked' ? !needsNoDigest : true) && (!wantRoute || route === wantRoute);
    const status = statusOf(fixture.expect, outcome, confidence);
    rows.push({...base, outcome, confidence, rung: rungOf(result), route, digestOk, status: digestOk === false && (status === 'exact' || status === 'ok') ? 'miss' : status, answer: captured || fixture.answer || null});
  }
  return rows;
}

// Hit rates per source group and per rung; the wrong-and-confident list. Never one blended number: reconstructed and invented fixtures must not lift the real ones.
export function summarize(rows) {
  const bySource = {}, byRung = {};
  const add = (bucket, key, row) => { const entry = bucket[key] ||= {total: 0, hits: 0, exact: 0}; entry.total++; if (row.status === 'exact' || row.status === 'ok') entry.hits++; if (row.status === 'exact') entry.exact++; };
  for (const row of rows) { add(bySource, SOURCE_GROUP[row.source] || row.source, row); add(byRung, `rung ${row.rung}`, row); }
  return {bySource, byRung, wrongConfident: rows.filter(row => row.status === 'wrong-confident'), noAnswer: rows.filter(row => row.status === 'no-answer')};
}

// The live run is on the plan (Claude Code), never on an API key.
export function assertNoApiSpend({env = process.env, engine}) {
  if (env.ANTHROPIC_API_KEY) throw new Error('ladder-score: ANTHROPIC_API_KEY is set; unset it (the score runs on the plan, never on an API key)');
  if (env.CI) throw new Error('ladder-score: not in CI (a CI run would spend the test keys); the live score runs on a Mac, on the plan');
  if (engine !== 'cli') throw new Error(`ladder-score: the live score runs on Claude Code on the plan (engine cli), not "${engine}"`);
}
