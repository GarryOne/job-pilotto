// Every number box on an Actions card says what it counts beside it (owner, 7 Oct 2026: "the 2 in the input field: what does it count?").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('every .task-count input sits in a .task-count-field with a visible .task-count-unit', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const inputs = html.match(/<input[^>]*class="task-count"[^>]*>/g) || [];
  assert.ok(inputs.length >= 2, 'the Actions page has its count boxes');
  for (const input of inputs) {
    const at = html.indexOf(input);
    assert.match(html.slice(at - 40, at), /<label class="task-count-field">$/, `${input.slice(0, 60)} is not in a .task-count-field`);
    assert.match(html.slice(at + input.length, at + input.length + 60), /^<span class="task-count-unit">[^<]+<\/span><\/label>/, `${input.slice(0, 60)} has no visible unit`);
  }
});
