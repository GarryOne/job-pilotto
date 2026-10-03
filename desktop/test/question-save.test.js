// A standard-answer question's Save waits for an answer: enabled on an empty field it did nothing, which read as broken (UI loop #64).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('question Save starts disabled and follows the answer field', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf("textContent: 'Save'"), source.indexOf("skip.addEventListener('click'"));
  assert.match(body, /save\.disabled = true;/);
  assert.match(body, /addEventListener\('input', \(\) => \{ save\.disabled = !input\.value\.trim\(\); \}\)/);
  assert.match(body, /save\.disabled = !input\.value\.trim\(\); \}/);
});
