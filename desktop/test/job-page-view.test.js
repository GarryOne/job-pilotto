// Jobs → a job's page (renderer/job-page-view.js): which tabs a job has and what each shows, from the store's sections and events.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {SECTIONS, TABS, allAnswers, headerFacts, kitParts, matchGroups, pageParts, plain, readablePart} from '../renderer/job-page-view.js';

const demo = JSON.parse(fs.readFileSync(new URL('../demo/job-pages.json', import.meta.url), 'utf8'));

test('a tab shows only when the job has its content, in the mockup order', () => {
  assert.deepEqual(pageParts({}).tabs, []);
  assert.deepEqual(pageParts({sections: {[SECTIONS.prep]: '### Ask them\n\n- On-call?'}}).tabs, [['prep', 'Prep']]);
  assert.deepEqual(pageParts({sections: {[SECTIONS.record]: '```json\n{}\n```'}}).tabs, [], 'only machine-readable JSON: nothing to read');
  const all = Object.fromEntries(Object.values(SECTIONS).map(name => [name, '- something']));
  assert.deepEqual(pageParts({sections: all, events: [{kind: 'Applied', at: '2026-10-01'}], match: {fit: 80, tier: 'Strong'}}).tabs.map(([key]) => key),
    TABS.map(([key]) => key));
});

// The search's facts (src/stores/matches_sync.py facts, the Job Matches columns), on every store: what a Notion user reads in those columns.
test('Match: the fit line and the job\'s facts, only those it has; none for a job added by hand', () => {
  assert.deepEqual(matchGroups(null), []);
  const groups = matchGroups({fit: 82, tier: 'Strong', confidence: 'High', scored: '2026-10-09', scoring_method: 'Previous', seniority: 'Senior',
    role_family: 'SRE', work_mode: 'Hybrid', languages: ['English', 'German +'], technologies: 'Kubernetes; Terraform', salary: 'CHF 140-160k',
    recruiter: true});
  assert.deepEqual(groups.map(group => group.title), ['Fit', 'About the job']);
  assert.deepEqual(groups[0].lines, ['🎯 82 · Strong · confidence High', 'Scored 9 Oct 2026 (from your earlier Profile)']);
  assert.deepEqual(groups[1].lines, ['Seniority · Senior', 'Role family · SRE', 'Work mode · Hybrid', 'Languages · English, German (a plus)',
    'Technologies · Kubernetes; Terraform', 'Salary · CHF 140-160k', 'Posted by a recruiter']);
  assert.deepEqual(matchGroups({fit: 60, tier: '', languages: '', recruiter: false}).map(group => group.lines), [['🎯 60']], 'only what it has');
  assert.deepEqual(pageParts({match: {fit: 70}}).tabs, [['match', 'Match']], 'a match nobody acted on still has its page');
});

test('the kit: from its JSON when it has one (copyable answers), else its text', () => {
  const kit = kitParts({check_before_sending: ['Start date'], highlights: ['SLOs'], cover_letter: 'Dear team,\n\nHi',
    answers: [{question: 'Notice period', answer: '3 months', needs_review: false}, {question: 'Salary', answer: '140k', needs_review: true}]});
  assert.deepEqual(kit.answers, [{question: 'Notice period', answer: '3 months', review: false}, {question: 'Salary', answer: '140k', review: true}]);
  assert.equal(kit.letter, 'Dear team,\n\nHi');
  assert.equal(allAnswers(kit.answers), 'Notice period\n3 months\n\nSalary\n140k');
  assert.deepEqual(kitParts(null, '### ✉️ Cover letter\n\nDear **team**\n\n### Machine-readable kit\n\n```json\n{"x": 1}\n```').groups,
    [{title: '✉️ Cover letter', lines: [{text: 'Dear team', strong: false, todo: null, quote: false}]}]);
  assert.equal(kitParts({eligible: false, eligibility_note: 'Needs a permit'}).ineligible, 'Needs a permit');
});

test('messages: the recruiter message and every 📥 section; history newest first', () => {
  const parts = pageParts({sections: {[SECTIONS.recruiter]: 'Hi Alex', '📥 Logged messages': '### 📥 3 Oct · Call?\n\n> Tuesday 10:00'},
    events: [{kind: 'Applied', at: '2026-10-01', note: 'With the [extension](https://x)'}, {kind: 'Replied', at: '2026-10-03'}, {at: '2026-10-04'}]});
  assert.deepEqual(parts.groups.messages.map(g => g.title), ['🤝 Recruiter message', '📥 3 Oct · Call?']);
  assert.deepEqual(parts.history.map(item => item.kind), ['Replied', 'Applied']);
  assert.equal(parts.history[1].note, 'With the extension');
});

test('Markdown to words: links, marks, escapes, toggles and to-dos', () => {
  assert.equal(plain('**Bold** and *it* `code` \\- [a link](https://x)'), 'Bold and it code - a link');
  assert.equal(plain('▸ Evidence'), 'Evidence');
  assert.equal(plain('> Hi Alex'), 'Hi Alex');
  assert.equal(plain('[ ] Lead with numbers'), 'Lead with numbers');
  assert.doesNotMatch(readablePart('Text\n\n### Machine-readable record\n\n```json\n{"a": 1}\n```'), /json|Machine/);
});

test('screenshots belong with the messages: an image alone shows the Messages tab; other files stay out', () => {
  const parts = pageParts({files: [{name: 'chat.png', type: 'image/png', url: 'data:image/png;base64,AA'}, {name: 'cv.pdf', type: 'application/pdf', url: 'data:x'}]});
  assert.deepEqual(parts.tabs, [['kit', 'Kit'], ['messages', 'Messages']], 'the PDF goes with the kit');
  assert.deepEqual(parts.shots.map(shot => shot.name), ['chat.png']);
});

test('the job\'s other files (a tailored CV) are listed with the kit, even with no kit section', () => {
  const parts = pageParts({files: [{name: 'CV · Acme.pdf', type: 'application/pdf', url: 'data:application/pdf;base64,AA'}]});
  assert.deepEqual(parts.tabs, [['kit', 'Kit']]);
  assert.deepEqual(parts.documents.map(file => file.name), ['CV · Acme.pdf']);
});

test('the header: stage, applied date, place and fit', () => {
  assert.equal(headerFacts({location: 'Zurich', fit: 82}, {stage: 'Applied', applied_on: '2026-10-01'}), 'Applied · applied 1 Oct 2026 · Zurich · 🎯 82');
  assert.equal(headerFacts({stage: 'Saved'}), 'Saved');
});

test('the demo job has every tab, and its kit reads from the JSON', () => {
  const page = demo['https://example.com/jobs/1'];
  const kit = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(page.sections[SECTIONS.kit])[1]);
  const parts = pageParts({...page, kit});
  assert.deepEqual(parts.tabs.map(([key]) => key), TABS.map(([key]) => key));
  assert.equal(parts.kit.answers.length, 2);
});
