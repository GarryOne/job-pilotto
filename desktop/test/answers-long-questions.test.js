// Application answers (owner's screenshot, 17 Oct 2026: "long text… looks broken"): a form question longer than 90 characters is still a question,
// answered or open, never prose; a real note (an instruction for the AI) stays a note and is folded as "Note for the AI".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {sections} from '../renderer/answers-model.js';

// The owner's lines under "Form-filling time" (cut at 120 characters by an older build, or open with "asked by").
const NOTE = 'For each application, count only the AI\'s active time spent researching the role, preparing answers, navigating the form, entering information, uploading documents, and checking the completed draft. Add active work intervals across sessions.';
const LINES = [
  ['We require all colleagues to meet in person 2-4 times a year, at internal company events lasting between 1-2 weeks. We t: Yes', {open: false, value: 'Yes'}],
  ['In the past ten years, looking only at the time since you graduated your first undergraduate degree, how many companies: 4', {open: false, value: '4'}],
  ['Are you able to provide professional references and criminal record checks? As a regulated bank, we need to ask for it p: ❓ (asked by N26)', {open: true, asked: 'N26'}],
  ['To be eligible to work in Switzerland, employees need to have Swiss or EU/EFTA citizenship or a work permit. Please sele: ❓ (asked by Adnovum)', {open: true, asked: 'Adnovum'}],
];
const page = [{type: 'heading_2', id: 'h', text: 'Form-filling time'}, {type: 'paragraph', id: 'n', text: NOTE},
  ...LINES.map(([text], i) => ({type: 'paragraph', id: `q${i}`, text}))];

test('a long question line is a question (answered or open), never a note; the instruction stays a note', () => {
  const [section] = sections(page);
  const by = id => section.items.find(item => item.id === id);
  assert.equal(by('n').kind, 'note');
  LINES.forEach(([text, want], i) => {
    const item = by(`q${i}`);
    assert.equal(item.kind, 'line', text);
    assert.equal(item.question, text.slice(0, text.lastIndexOf(': ')), 'the whole question, up to its answer');
    for (const [key, value] of Object.entries(want)) assert.equal(item[key], value, `${key}: ${text}`);
  });
});

test('a section\'s notes are folded as "Note for the AI", never shown as answers', () => {
  const screen = fs.readFileSync(new URL('../renderer/pages/application-answers.js', import.meta.url), 'utf8');
  assert.match(screen, /Note for the AI/);
  assert.match(screen, /Cut short by an older version/, 'a question an older build cut at 120 characters says so');
  assert.doesNotMatch(screen, /saved\.append\(el\('p', 'muted small qa-note'/, 'no note printed as a paragraph among the answers');
});
