// Missing answers (15 Oct 2026): every unanswered required field gets one fixed meaning word and a by-design / gap flag on the fill card, never a wording or a value.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CAUSES, fillCard, cleanCard} from '../../extension/fill-card.js';
import {MEANINGS, meaningOf, designOf, validGapKey} from '../../extension/fill-meaning.js';

const NO_ANSWER = 'no answer in the kit, Profile or your details';
const row = (label, extra) => ({label, required: true, type: 'text', outcome: 'left', reason: NO_ANSWER, ...extra});

test('each kind of left field gets its meaning word and the right design flag', () => {
  const cases = [
    [row('q1', {reason: 'legal/consent: always your choice'}), 'legal', 'design'],
    [row('q2', {reason: 'written: your own words to write'}), 'written', 'design'],
    [row('q3', {reason: 'demographic: your own choice'}), 'demographic', 'design'],
    [row('q4', {type: 'password', reason: 'password: never typed, yours to set'}), 'password', 'design'],
    [row('q5', {type: 'file', reason: 'upload: no file for this question'}), 'file', 'design'],
    [row('q6', {reason: 'question on the page not read'}), 'unread', 'gap'],
    [row('q7', {reason: 'proposed for you to confirm', fact: 'salary', category: 'normal'}), 'salary', 'gap'],
    [row('q8', {reason: 'proposed for you to confirm', fact: 'work_permit', category: 'knockout'}), 'work_permit', 'design'],
    [row('q9', {reason: 'proposed for you to confirm', fact: 'referral_source', low: 'unsure'}), 'referral_source', 'design'],
    [row('q10', {reason: 'a detail of yours not saved yet (linkedin)', known: 'linkedin'}), 'links', 'gap'],
    [row('q11', {reason: 'the AI gave no answer'}), 'unknown', 'gap'],
  ];
  for (const [one, meaning, design] of cases) {
    const cause = one.reason.startsWith('proposed') ? 'proposed' : 'other';
    assert.equal(meaningOf(one), meaning, one.label);
    assert.equal(designOf(one, meaning, cause), design, one.label);
  }
});

test('the card carries meaning:cause:design counts, only fixed words, and cleanCard drops anything else', () => {
  const trace = [row('a', {reason: 'proposed for you to confirm', fact: 'salary'}), row('b', {reason: 'proposed for you to confirm', fact: 'salary'}), row('c', {type: 'password', reason: 'password: never typed, yours to set'}),
    row('d', {outcome: 'filled', reason: ''}), row('e', {reason: 'legal/consent: always your choice'}), row('f', {reason: 'written: your own words to write'})];
  const card = fillCard({id: 'card-12345678', trace, useAI: true});
  assert.equal(card.left, 3, 'consent and own-words rows stay out of the counts');
  assert.deepEqual(card.gaps, {'salary:proposed:gap': 2, 'password:other:design': 1, 'legal:other:design': 1, 'written:other:design': 1});
  const clean = cleanCard({...card, gaps: {...card.gaps, 'What is your salary:proposed:gap': 3, 'salary:made_up:gap': 1, 'salary:proposed:maybe': 1, 'nothing:proposed:gap': 1}});
  assert.deepEqual(clean.gaps, card.gaps);
});

test('every meaning word and cause makes a key the site accepts; a word outside the list does not', () => {
  for (const meaning of MEANINGS) for (const cause of CAUSES) for (const design of ['design', 'gap']) assert.ok(validGapKey(`${meaning}:${cause}:${design}`, CAUSES), `${meaning}:${cause}:${design}`);
  assert.ok(!validGapKey('anything:proposed:gap', CAUSES));
});
