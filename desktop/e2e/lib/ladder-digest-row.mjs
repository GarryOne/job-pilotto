// One row of the digest score (e2e/ladder-digest-score.mjs), as data and as a line. A row keeps the validated answer AND what the model itself said (`raw`), the press_kind it gave the
// control it chose, and what the validator dropped, so a miss can be read: a number outside the candidates, a sign-in judged "apply". Never a candidate's text: its number and kind only.
// Guard: test/ladder-digest-row.test.js.
import {SURE} from './ladder-score.mjs';

// What the digest should say for a ladder outcome (a posting with an Apply control is "form": press it).
// form_in_frame: the application sits in an embedded frame of the posting: the digest must say form AND name a listed frame (formFrame), #715 / 14 Oct 2026.
export const DIGEST_OUTCOME = {form_in_frame: ['form'], posting: ['form', 'link'], email: ['email'], phone: ['phone'], in_person: ['in_person'], expired: ['expired'], login_wall: ['login_wall'], refused: ['refused'], other: ['other']};

export function digestRow(fixture, answer) {
  const want = DIGEST_OUTCOME[fixture.expect.outcome], inFrame = fixture.expect.outcome === 'form_in_frame';
  const hit = !answer.error && want.includes(answer.outcome) && (!inFrame || Number.isInteger(answer.formFrame));
  const raw = answer.raw ? {outcome: answer.raw.outcome ?? '', verb: answer.raw.verb ?? '', numbers: Array.isArray(answer.raw.numbers) ? answer.raw.numbers : []} : null;
  return {id: fixture.id, source: fixture.source, trap: !!fixture.trap, expected: want[0], outcome: answer.error ? `error: ${answer.error}` : answer.outcome, verb: answer.verb, numbers: answer.numbers,
    confidence: answer.confidence ?? 0, ...(inFrame ? {formFrame: answer.formFrame ?? -1} : {}), dropped: answer.dropped || '', raw, pressKind: answer.raw?.press_kind || '',
    status: hit ? 'hit' : !answer.error && (answer.confidence ?? 0) >= SURE ? 'wrong-confident' : 'miss', chosen: (answer.chosen || []).map(item => `${item.n}:${item.kind}`)};
}

const pad = (text, width) => String(text ?? '').padEnd(width).slice(0, width);
export function digestRowLine(row) {
  const said = row.raw ? ` raw=${row.raw.outcome}/${row.raw.verb}/[${row.raw.numbers.join(',')}]` : '';
  return `${pad(row.id, 36)} ${pad(row.source, 13)} want ${pad(row.expected, 10)} got ${pad(row.outcome, 24)} ${pad(row.verb || '-', 11)} ${pad(JSON.stringify(row.numbers ?? []), 8)} ${row.confidence.toFixed(2)} ${row.status}`
    + `${said} press_kind=${row.pressKind || '-'} dropped=${row.dropped || '-'}`;
}
