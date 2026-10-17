// A standard-answer question's Save waits for an answer: enabled on an empty field it did nothing, which read as broken (UI loop #64).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('question Save starts disabled and follows the answer field', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/jobs-questions.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf("textContent: 'Save'"), source.indexOf("skip.addEventListener('click'"));
  assert.match(body, /save\.disabled = true;/);
  // The answer control (renderer/question-control.js, any kind) tells Save when it holds an answer.
  const all = source.slice(source.indexOf('answerControl(q.format'), source.indexOf("skip.addEventListener('click'"));
  assert.match(all, /answerControl\(q\.format, [^\n]*value => \{ save\.disabled = !String\(value\)\.trim\(\); \}/);
  assert.match(body, /save\.disabled = !String\(input\.value\)\.trim\(\); \}/);
});
