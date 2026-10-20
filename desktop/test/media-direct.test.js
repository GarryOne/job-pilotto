// The AI director's plan (desktop/scripts/media/direct.mjs) is kept only when it is sound: known looks, zooms within range, a short caption.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prompt, validatePlan} from '../scripts/media/direct.mjs';

const looks = ['#jobs-body', '#job-panel'];
const good = {zooms: {'#jobs-body': 1.35, '#job-panel': 1}, caption: 'Jobs ranked by how they fit', shows: 'The job list', alt: 'A list of jobs with fit scores'};

test('a sound plan is kept, also inside a code fence', () => {
  assert.deepEqual(validatePlan(JSON.stringify(good), looks).plan.zooms, {'#jobs-body': 1.35, '#job-panel': 1});
  assert.ok(validatePlan(`\`\`\`json\n${JSON.stringify(good)}\n\`\`\``, looks).plan);
});

test('an unknown look, a zoom out of range, a long caption or prose is refused', () => {
  assert.match(validatePlan({...good, zooms: {'.other': 1.2}}, looks).error, /unknown look/);
  assert.match(validatePlan({...good, zooms: {'#jobs-body': 3}}, looks).error, /outside/);
  assert.match(validatePlan({...good, caption: 'one two three four five six seven'}, looks).error, /caption/);
  assert.match(validatePlan('Here is my plan: zoom a bit', looks).error, /not JSON/);
  assert.match(validatePlan({...good, alt: 'x'.repeat(301)}, looks).error, /alt/);
  assert.ok(validatePlan({...good, alt: 'x'.repeat(280)}, looks).plan, 'a full alt text fits');
});

test('the prompt names every look and asks for JSON only', () => {
  const text = prompt('hero', looks);
  assert.ok(looks.every(look => text.includes(look)) && /ONLY this JSON/.test(text));
});
