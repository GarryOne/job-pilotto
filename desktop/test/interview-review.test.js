// An interview review's message, as the card's parts (renderer/interview-review.js). The shape is the one
// src/ai/interviews.py writes; a message that isn't a review comes back null, so its plain text still shows.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseInterviewReview} from '../renderer/interview-review.js';

const REVIEW = [
  '🎤 Interview · Recruiter screen',
  'Huxley — Principal SRE',
  '',
  'Recruiter screen with Huxley (agency) for an unnamed client\'s Principal SRE role, covering contract options,',
  'Swiss work permit (valid to 2030), salary and location flexibility.',
  '',
  '✅ Strong',
  '• Clear work authorisation: Swiss permit valid until 2030, which removes a common recruiter concern.',
  '• Flexible on location (Switzerland, Dubai, UK, US), which widens the roles the recruiter can place you in.',
  '• Got the process clarified: only two stages (CTO, then HR).',
  '⚠️ Weak answers (1 of 4)',
  '• Salary expectations: 150k is exactly your stated minimum and low for a Principal SRE in Switzerland.',
  '🏋️ Practise',
  '• Prepare a principal-level architecture narrative for the CTO.',
  '➡️ Next: Send the recruiter your updated CV.',
  '📈 Stage → Interview scheduled',
].join('\n');

test('a review becomes a header, a summary, its sections and the next step', () => {
  const review = parseInterviewReview(REVIEW);
  assert.equal(review.round, 'Recruiter screen');
  assert.equal(review.title, 'Huxley — Principal SRE');
  assert.match(review.summary, /^Recruiter screen with Huxley \(agency\)/);
  assert.match(review.summary, /location flexibility\.$/);  // the paragraph's two lines joined
  assert.deepEqual(review.sections.map(s => [s.icon, s.label, s.items.length]),
    [['✅', 'Strong', 3], ['⚠️', 'Weak answers (1 of 4)', 1], ['🏋️', 'Practise', 1]]);
  assert.match(review.sections[1].items[0], /^Salary expectations: 150k/);
  assert.equal(review.next, 'Send the recruiter your updated CV.');
  assert.equal(review.stage, 'Stage → Interview scheduled');
});

test('what is not a review stays plain text', () => {
  assert.equal(parseInterviewReview('📧 Gmail checked: no new job emails.'), null);
  assert.equal(parseInterviewReview(''), null);
  assert.equal(parseInterviewReview(null), null);
  // A header and a title alone can't be drawn as a review.
  assert.equal(parseInterviewReview('🎤 Interview · Recruiter screen\nHuxley — Principal SRE'), null);
});

test('a review with no bullets still shows its sections (a bare "Strong" is information too)', () => {
  const bare = '🎤 Interview · Technical screen\nAcme — SRE\n\nA short screen.\n\n✅ Strong\n⚠️ Weak answers (0 of 3)';
  const review = parseInterviewReview(bare);
  assert.equal(review.title, 'Acme — SRE');       // always written by src/ai/interviews.py, right under the header
  assert.equal(review.summary, 'A short screen.');
  assert.deepEqual(review.sections.map(s => s.label), ['Strong', 'Weak answers (0 of 3)']);
  assert.deepEqual(review.sections.map(s => s.items.length), [0, 0]);
});
