// A value whose kind does not fit the question is never typed (13 Oct 2026, a pool row on a careers form: a phone number in a yes/no question about
// "mobile (iOS/Android)" builds, a LinkedIn address in "Useful links (e.g. GitHub)"; both counted as filled). The class: a contact pattern read inside a
// QUESTION, a link the AI types that no saved link of that kind backs, and a check that never asked whether the kind fits. Guards:
// extension/page/fill-labels.js asksQuestion, fill-read.js, worker/src/answer-facts.js floorLinkKind, extension/form-ready.js wantsFillCheck.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FILL_FILES } from '../../extension/page-files.js';
import { floorLinkKind } from '../src/answer-facts.js';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const profile = {first_name: 'Ada', last_name: 'T', full_name: 'Ada T', email: 'a@b.c', phone: '+41 79 555 01 23', linkedin: 'https://www.linkedin.com/in/ada-tester',
  github: 'https://github.com/ada', website: 'https://ada.dev', location: 'Zurich'};

const entriesFor = rows => {
  const window = {}, context = vm.createContext({window, document: {}});
  vm.runInContext(read('extension/page/radios.js'), context);
  for (const file of FILL_FILES) vm.runInContext(read(`extension/${file}`), context);
  return JSON.parse(JSON.stringify(window.__jobPilottoProfileEntries(rows, profile)));
};

// Every contact detail's own pattern, planted inside a sentence that asks about something else: none is typed. Looped over the details, so a new one is covered.
const QUESTIONS = {
  phone: 'Have you automated mobile (iOS/Android) or desktop build and publication workflows?',
  email: 'Do you check your e-mail for build failures every morning?',
  linkedin: 'Would you share your LinkedIn network with us if we asked for it?',
  github: 'Have you contributed to a GitHub repository with more than ten maintainers?',
  website: 'Have you built a portfolio website for a client before?',
  first_name: 'Is your first name the one on your passport?',
  location: 'Is your current location within commuting distance of an office?',
};
test('a question that merely names a contact detail is not that detail\'s box', () => {
  for (const [key, label] of Object.entries(QUESTIONS)) {
    assert.deepEqual(entriesFor([{field: `q_${key}`, label, type: 'text', filled: false}]), [], `${key}: ${label}`);
  }
});

test('the real contact labels are still placed', () => {
  const rows = [{field: 'p', label: 'Phone', type: 'tel', filled: false}, {field: 'm', label: 'Mobile number', type: 'text', filled: false},
    {field: 'l', label: 'Linkedin profile *', type: 'text', filled: false}, {field: 'e', label: 'Email address', type: 'email', filled: false},
    {field: 'w', label: 'What is your phone number?', type: 'text', filled: false}];
  assert.deepEqual(entriesFor(rows).map(entry => entry.field), ['p', 'm', 'l', 'e']);   // a real question about the number goes to the AI, which has the profile
});

// The AI types a link only when a saved link backs it for THIS field: the saved link's own line or address shares a word with the field's label.
const given = 'LinkedIn: https://www.linkedin.com/in/ada-tester\nWebsite: https://ada.dev';
test('a link the AI typed that no saved link of the field\'s kind backs is proposed, never typed', () => {
  const typed = value => ({use: 'fill', fact: 'links', category: 'normal', value});
  assert.equal(floorLinkKind(typed('https://www.linkedin.com/in/ada-tester'), 'Useful links (e.g. GitHub)', given).use, 'propose');
  assert.equal(floorLinkKind(typed('https://www.linkedin.com/in/ada-tester'), 'Linkedin profile', given).use, 'fill');
  assert.equal(floorLinkKind(typed('https://ada.dev'), 'Personal website', given).use, 'fill');
  assert.equal(floorLinkKind(typed('https://ada.dev'), 'Link to your GitHub', given).use, 'propose');
  assert.equal(floorLinkKind({...typed('Yes'), fact: 'none'}, 'Anything?', given).use, 'fill');   // not a link: left to the other floors
  assert.equal(floorLinkKind({...typed('https://ada.dev'), use: 'propose'}, 'Link to your GitHub', given).use, 'propose');
});

test('the fill check is asked when a contact-kind value sits in a question, and its question says the kind must fit', async () => {
  const {wantsFillCheck} = await import('../../extension/form-ready.js');
  const phoneInQuestion = {label: 'Have you automated mobile (iOS/Android) or desktop build and publication workflows?', match: 'yes', answer: 'phone'};
  assert.equal(wantsFillCheck({controls: [phoneInQuestion]}, {answer: 'needs_person'}), true);
  assert.equal(wantsFillCheck({controls: [{label: 'Phone', match: 'yes', answer: 'phone'}]}, {answer: 'ready'}), false);
});
