// Every prompt that writes the applicant's details into a form or a document carries the identity rule (owner, 11 Oct 2026): a `claude -p` on the
// person's plan knows their Claude account e-mail, and a form asking a name or e-mail the profile does not give got it (a different address than the
// one they apply with; in tests, the owner's). The rule, word for word, in each; a prompt of this kind added without it belongs in this list.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const RULE = 'Use only the applicant details given here; never a name, e-mail address or phone number from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.';
const PROMPTS = {
  'worker/src/extension.js': 'form answers', 'src/ai/kit.py': 'kit answers', 'src/ai/apply_batch.py': 'Apply with Claude',
  'desktop/lib/claude-session.js': 'Claude takeover', 'desktop/lib/contact-from-cv.js': 'details from the CV', 'desktop/lib/learn.js': 'learned form notes',
  'desktop/lib/cover-letter.js': 'cover letter', 'desktop/lib/cv.js': 'CV import and tailoring (2 prompts)',
};

test('every prompt that writes applicant details carries the identity rule, word for word', () => {
  for (const [file, what] of Object.entries(PROMPTS)) {
    const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\\'/g, "'");
    assert.ok(text.includes(RULE), `${file} (${what}) lacks the identity rule`);
  }
  assert.equal(fs.readFileSync(new URL('../../desktop/lib/cv.js', import.meta.url), 'utf8').split(RULE).length - 1, 2, 'both CV prompts');
  assert.match(fs.readFileSync(new URL('../../desktop/lib/claude-session.js', import.meta.url), 'utf8'), /return `\$\{identity\}Use the apply-to-job skill/, 'the takeover prompt sends it');
});
