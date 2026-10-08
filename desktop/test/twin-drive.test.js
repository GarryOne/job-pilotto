// The live-test twin driver never presses a form's Submit, in any language; our own panel's buttons are allowed (owner, 8 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {looksLikeSubmit} from '../e2e/lib/twin-guards.mjs';

test('a form\'s Submit is refused in any language; our panel\'s Fill again is not', () => {
  for (const text of ['Submit application', 'submit', 'Envoyer la candidature', 'Soumettre', 'Bewerbung abschicken', 'Absenden', 'Inviare', 'Enviar', 'Verzenden'])
    assert.ok(looksLikeSubmit(text), text);
  for (const text of ['Fill again', 'Postuler »', 'Next', 'Weiter', 'Suisse']) assert.ok(!looksLikeSubmit(text), text);
  assert.ok(!looksLikeSubmit('submit', true), 'inside our own panel');
});

test('the driver reaches only the twin\'s own ports and never reads a password value', () => {
  const source = fs.readFileSync(new URL('../e2e/twin-drive.mjs', import.meta.url), 'utf8');
  assert.match(source, /connectOverCDP\(twin\(\)\[which\]\)/);                // twin.json's ports only
  assert.doesNotMatch(source, /47111|9339/);
  assert.match(source, /if \(el\.type === 'password'\) return \{label: text, type: 'password'\}/);
  assert.match(source, /looksLikeSubmit\(/);
});

test('every action in the app window is a visible one through its own screens, and each one checks for a Submit', () => {
  const source = fs.readFileSync(new URL('../e2e/twin-drive.mjs', import.meta.url), 'utf8');
  for (const name of ['click', 'press', 'type']) {
    const body = source.slice(source.indexOf(`async ${name}(`), source.indexOf('\n  },', source.indexOf(`async ${name}(`)));
    assert.match(body, /await show\(/, `${name} outlines its target first`);
  }
  for (const name of ['click', 'press']) assert.match(source.slice(source.indexOf(`async ${name}(`)).split('\n  },')[0], /looksLikeSubmit/, `${name} refuses a Submit`);
});
