// Profile → Application answers → "Profile facts used in forms" (owner's mockup 02, decision 1, 18 Oct 2026): the facts of Your details that forms asked
// for, read-only label | value rows (card-shell.js readRows) and one reference row (page-parts.js referenceRow) whose link opens Your details, the fact's one home. Never an input here: a fact is
// changed in Your details, and every form answer follows it. The list: lib/form-facts.js over IPC 'formFacts'. Guarded by test/form-facts.test.js.
import {el} from '../components.js';
import {readRows} from '../card-shell.js';
import {referenceRow} from '../page-parts.js';

const openDetails = () => document.querySelector('[data-profile-tab="details"]')?.click();

export async function loadAnswersFacts() {
  const node = document.getElementById('answers-facts-body');
  if (!node) return;
  const result = await window.pilot.formFacts().catch(error => ({ok: false, error: error.message}));
  if (!result?.ok) { node.replaceChildren(el('p', 'message error', `Couldn't read them: ${result?.error || 'no answer'}`)); return; }
  // Label | value rows, then one reference to their home (one link, not one per row: mockup 02's "From Your details").
  node.replaceChildren(...(result.facts.length
    ? [readRows(result.facts.map(fact => ({label: fact.label, value: fact.value}))), referenceRow({text: 'A change there reaches every form.', open: openDetails})]
    : [el('p', 'muted', 'No form has asked for a fact of Your details yet. When one does, it shows here and is answered from Your details.')]));
}
