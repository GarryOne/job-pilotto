// The session page recognises a form question Claude reworded (so it isn't listed twice).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sameQuestion} from '../renderer/labels.js';

test('the same question, reworded or cut short; different questions stay apart', () => {
  // Canonical, 29 Sep 2026: listed twice on the session page.
  assert.equal(sameQuestion('I agree to use only my own words; AI-generated content will disqualify my application',
    'During this application process I agree to use only my own words. I understand that plagiarism, the use of AI or other g'), true);
  assert.equal(sameQuestion("Confirm you have read and agree to Canonical's Recruitment Privacy Notice",
    "Please confirm that you have read and agree to Canonical's Recruitment Privacy Notice and Privacy Policy."), true);
  assert.equal(sameQuestion('Rationale or evidence for the high school selections',
    'Please share your rationale or evidence for the high school performance selections above.'), true);
  assert.equal(sameQuestion('First Name', 'First Name *'), true);
  assert.equal(sameQuestion('First Name', 'Last Name'), false);
  assert.equal(sameQuestion('Any relatives or partners working at N26?', 'How did you perform in mathematics at high school?'), false);
  assert.equal(sameQuestion('', 'Email'), false);
});
