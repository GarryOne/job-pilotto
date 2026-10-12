// The quality suite's fact judge sees what the scoring saw: the Profile only, never the CV (#350: CV-only skills made true "not in your profile" gaps look invented).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('the score-text judge is given the Profile the scorer read, not the CV text', () => {
  const source = fs.readFileSync(new URL('../suites/quality.mjs', import.meta.url), 'utf8');
  const step = source.slice(source.indexOf("ctx.run('the score reasons say nothing invented"), source.indexOf('summary.invented ='));
  const line = /const profile = (.+);/.exec(step)?.[1] || '';
  assert.match(line, /THE PROFILE/);
  assert.doesNotMatch(line, /\bcandidate\b/, 'the CV text (candidate.txt) is in the judge\'s profile again');
  assert.match(fs.readFileSync(new URL('../../../src/ai/score.py', import.meta.url), 'utf8'), /using only the profile and the posting/,
    'the scorer no longer reads only the Profile: give the judge what it reads now');
});
