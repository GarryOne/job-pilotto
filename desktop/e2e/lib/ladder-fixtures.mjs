// Loads the ladder fixtures (desktop/e2e/ladder-fixtures/*.json): the page sketch as the extension builds it, the expected outcome and the AI's stored answer. Used by ladder-score.mjs and the tests.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ladder-fixtures');
// What a page can turn out to be (docs/superpowers/specs/2026-10-10-ai-ladder.md): the outcomes pageKind can name today plus the ones the ladder adds.
export const OUTCOMES = ['form', 'account', 'posting', 'email', 'phone', 'link', 'login_wall', 'expired', 'in_person', 'form_in_frame', 'other'];
export const SCHEMA_VERSION = 1;
// The questions of rung 2 a fixture can ask (docs/flows/ladder.md): the page-kind sketch (the default, no `question` field), and the two judges' questions. Additive: a fixture without `question` is page_kind.
export const QUESTIONS = ['page_kind', 'account_ready', 'account_result', 'form_step'];
export const questionOf = fixture => fixture.question || 'page_kind';
// The fixed answers each question can give (an expectation is one of them; `pending` too, for a captured candidate nobody confirmed).
export const OUTCOMES_BY_QUESTION = {page_kind: OUTCOMES, account_ready: ['ready', 'needs_person', 'unsure'], account_result: ['created', 'created_confirm', 'needs_code', 'already_exists', 'refused', 'unsure'], form_step: ['middle', 'final', 'unsure']};
// What the judges' sketch holds (the extension's accountSketch, extension/account-fill.js: never a typed value); fromPath and sameForm only after a press (account_result).
export const JUDGE_SKETCH_FIELDS = ['title', 'headings', 'controls', 'buttons', 'texts', 'frames', 'fromPath', 'sameForm'];
// The fields a fixture may carry (adding one is a one-line change here; the test fails on an undeclared one). `rung` (0-6) and `signal` (unsure|contradicted|stalled|failed) are for the
// admin page; `expect` may later carry form_frame (an index into frameCandidates) and a closed verb with candidate numbers (slice B).
export const FIELDS = ['schemaVersion', 'id', 'question', 'source', 'lang', 'why', 'note', 'trap', 'url', 'capture', 'sketch', 'candidates', 'expect', 'answer', 'answer_path', 'rung', 'signal', 'file'];
// `apply_route` (manual | reuse_previous | third_party_account) and `digest` (not_asked: rung 2 names the manual route and its button, so the numbered digest is not needed; asked: it is) are for start dialogs.
export const EXPECT_FIELDS = ['outcome', 'accept', 'apply_route', 'digest', 'form_frame', 'verb', 'candidates'];
export const LANGS = ['de', 'fr', 'en', 'it'];
export const SOURCES = ['recorded', 'captured', 'reconstructed', 'invented'];

export function loadFixtures(dir = DIR) {
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    return {...fixture, file: name};
  });
}
