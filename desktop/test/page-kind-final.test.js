// The AI's sure "other" is final: a page with form fields is not turned into the application form by them (extension/page-kind-final.js, fill-flow.js).
// 13 Oct 2026, the owner's own Chrome: "page kind: other, 0.97" on a pull request, then "page kind corrected: a posting with no Apply but a form's fields", then the fill.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FINAL_FROM, sureOther} from '../../extension/page-kind-final.js';
import {KEEP_FROM} from '../lib/ladder/rung2-sketch.js';

test('a sure "other" is final; a posting, an unsure answer and no answer are not', () => {
  assert.equal(sureOther({kind: 'other', signal: 'confident', confidence: 0.97, by: 'ai'}), true);
  assert.equal(sureOther({kind: 'other', signal: 'confident', confidence: 0.97, by: 'remembered'}), true);   // the kept answer too (it was sure when kept)
  assert.equal(sureOther({kind: 'posting', signal: 'confident', confidence: 0.97}), false);   // a posting with no Apply but a form's fields is the form: the correction stays for it
  assert.equal(sureOther({kind: 'other', signal: 'unsure', confidence: 0.5}), false);
  assert.equal(sureOther({kind: 'other', signal: 'confident', confidence: 0.7}), false);
  assert.equal(sureOther(null), false);
});

test('"sure" is the same line the app keeps an answer from', () => {
  assert.equal(FINAL_FROM, KEEP_FROM);
});

test('the fill flow\'s correction asks it before it forgets the AI\'s answer', () => {
  const source = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  const line = source.split('\n').findIndex(text => text.includes("a posting with no Apply but a form\\'s fields"));
  assert.ok(line > 0, 'the correction is still there for a posting');
  assert.match(source.split('\n').slice(line - 3, line + 1).join('\n'), /sureOther\(kind\)/);
  assert.match(source, /import \{sureOther\} from '\.\/page-kind-final\.js'/);
});
