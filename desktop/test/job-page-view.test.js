// Jobs → a job's page (renderer/job-page-view.js): which tabs a job has and what each shows, from the store's sections and events.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {shortDay} from '../renderer/date.js';
import {SECTIONS, TABS, allAnswers, factPairs, appliedLine, callFacts, clarifyOf, foundLine, glanceTiles, headerFacts, kitParts, lines, matchGroups, matchView, nextInterview, pageParts, paragraphize, plain, postingBlocks, postingFacts, postingSource, readablePart, submittedOf, tabKey, technologiesOf} from '../renderer/job-page-view.js';

const demo = JSON.parse(fs.readFileSync(new URL('../demo/job-pages.json', import.meta.url), 'utf8'));

test('every job has the same eight tabs in the same order; `has` says which have content', () => {
  const order = ['overview', 'match', 'description', 'application', 'interviews', 'review', 'messages', 'timeline'];
  assert.deepEqual(TABS.map(([key]) => key), order);
  assert.deepEqual(pageParts({}).tabs, TABS, 'a job with nothing saved still has them all (each says "nothing yet")');
  assert.ok(Object.values(pageParts({}).has).every(value => value === false));
  assert.equal(pageParts({sections: {[SECTIONS.prep]: '### Ask them\n\n- On-call?'}}).has.application, true);
  assert.equal(pageParts({sections: {[SECTIONS.record]: '```json\n{}\n```'}}).has.application, false, 'only machine-readable JSON: nothing to read');
  const all = Object.fromEntries(Object.values(SECTIONS).map(name => [name, '- something']));
  const has = pageParts({sections: all, events: [{kind: 'Applied', at: '2026-10-01'}], match: {fit: 80, tier: 'Strong'}}).has;
  assert.deepEqual(Object.keys(has).filter(key => has[key]).sort(), ['application', 'description', 'match', 'messages', 'overview', 'review', 'timeline']);
});

test('the old tab names land where their content lives now', () => {
  assert.deepEqual(['kit', 'prep', 'record', 'history', 'review', 'nonsense', ''].map(tabKey),
    ['application', 'application', 'application', 'timeline', 'review', 'overview', 'overview']);
});

// The search's facts (src/stores/matches_sync.py facts, the Job Matches columns), on every store: what a Notion user reads in those columns.
test('Match: the fit line and the job\'s facts, only those it has; none for a job added by hand', () => {
  assert.deepEqual(matchGroups(null), []);
  const groups = matchGroups({fit: 82, tier: 'Strong', confidence: 'High', scored: '2026-10-09', scoring_method: 'Previous', seniority: 'Senior',
    role_family: 'SRE', work_mode: 'Hybrid', languages: ['English', 'German +'], technologies: 'Kubernetes; Terraform', salary: 'CHF 140-160k',
    recruiter: true, posted: '2026-10-03', deadline: '2026-11-01', contract: 'Permanent', workload: '80-100%', on_call: 'No', visa: 'Not offered', remote_scope: ''});
  assert.deepEqual(groups.map(group => group.title), ['Fit', 'About the job']);
  assert.deepEqual(groups[0].lines, ['🎯 82 · Strong · confidence High', `Scored ${shortDay('2026-10-09')} (from your earlier Profile)`]);
  assert.deepEqual(groups[1].lines, [`Posted · ${shortDay('2026-10-03')}`, `Deadline · ${shortDay('2026-11-01')}`, 'Seniority · Senior', 'Role family · SRE',
    'Contract · Permanent', 'Work mode · Hybrid', 'Workload · 80-100%', 'On call · No', 'Visa sponsorship · Not offered', 'Languages · English, German (a plus)',
    'Technologies · Kubernetes; Terraform', 'Salary · CHF 140-160k', 'Posted by a recruiter']);
  assert.deepEqual(matchGroups({fit: 60, tier: '', languages: '', recruiter: false}).map(group => group.lines), [['🎯 60']], 'only what it has');
  assert.equal(pageParts({match: {fit: 70}}).has.match, true, 'a match nobody acted on still has its page');
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
  assert.equal(parts.has.messages, true);
  assert.equal(parts.has.application, true, 'the PDF goes with the application');
  assert.deepEqual(parts.shots.map(shot => shot.name), ['chat.png']);
});

test('the job\'s other files (a tailored CV) are listed with the kit, even with no kit section', () => {
  const parts = pageParts({files: [{name: 'CV · Acme.pdf', type: 'application/pdf', url: 'data:application/pdf;base64,AA'}]});
  assert.equal(parts.has.application, true);
  assert.deepEqual(parts.documents.map(file => file.name), ['CV · Acme.pdf']);
});

test('the header: stage, applied date, place and fit', () => {
  assert.equal(headerFacts({location: 'Zurich', fit: 82}, {stage: 'Applied', applied_on: '2026-10-01'}), `Applied · applied ${shortDay('2026-10-01')} · Zurich · 🎯 82`);
  assert.equal(headerFacts({stage: 'Saved'}), 'Saved');
});

test('the demo job has content for its tabs, and its kit reads from the JSON', () => {
  const page = demo['https://example.com/jobs/1'];
  const kit = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(page.sections[SECTIONS.kit])[1]);
  const parts = pageParts({...page, kit});
  assert.deepEqual(Object.keys(parts.has).filter(key => parts.has[key]).sort(), ['application', 'description', 'match', 'messages', 'overview', 'review', 'timeline']);
  assert.equal(parts.kit.answers.length, 2);
});

test('the key facts as pairs, and the list row\'s fields win over the stored match', () => {
  assert.deepEqual(factPairs({posted: '2026-10-03', salary: 'CHF 140k', recruiter: true}), [['Posted', shortDay('2026-10-03')], ['Salary', 'CHF 140k'], ['Posted by', 'a recruiter']]);
  assert.deepEqual(factPairs(null), []);
  assert.equal(matchView({url: 'u'}, {match: null}), null, 'never scored');
  const view = matchView({fit: 90, reason: ''}, {match: {fit: 80, reason: 'Stored', fit_detail: {gaps: 'Go'}}});
  assert.deepEqual([view.fit, view.reason, view.fit_detail.gaps], [90, 'Stored', 'Go']);
});

test('the drawer header\'s applied chip: only when it was applied', () => {
  assert.equal(appliedLine({}, {applied_on: '2026-10-01'}), `applied ${shortDay('2026-10-01')}`);
  assert.equal(appliedLine({stage: 'Saved'}), '');
});

test('the Overview\'s six tiles: what the posting says, "Not stated" when it does not, notes only for what is known', () => {
  const tiles = Object.fromEntries(glanceTiles({salary: 'CHF 130-150k', work_mode: 'Hybrid', seniority: 'Senior', role_family: 'SRE', languages: ['English', 'German +'],
    posted: '2026-10-03', deadline: '2026-11-01', workload: '80-100%', contract: 'Permanent'}).map(tile => [tile.key, tile]));
  assert.deepEqual(Object.keys(tiles), ['salary', 'mode', 'contract', 'seniority', 'languages', 'posted']);
  assert.deepEqual([tiles.salary.value, tiles.salary.note], ['CHF 130-150k', 'From the posting']);
  assert.equal(tiles.mode.note, 'Office days not stated', 'hybrid with no scope says so');
  assert.deepEqual([tiles.contract.value, tiles.contract.note], ['Permanent', 'Workload 80-100%']);
  assert.equal(tiles.languages.value, 'English; German (a plus)');
  assert.equal(tiles.posted.note, `Deadline ${shortDay('2026-11-01')}`);
  const none = glanceTiles(null);
  assert.ok(none.every(tile => tile.value === 'Not stated' && tile.note === '' && tile.known === false));
});

test('the Overview\'s lines: responsibilities a line each, technologies as chips, what to clarify, what the calls said, the next interview', () => {
  assert.deepEqual(lines('Run on-call\n\n  Build automation \n'), ['Run on-call', 'Build automation']);
  assert.deepEqual(technologiesOf({technologies: 'Kubernetes; Terraform;Go'}), ['Kubernetes', 'Terraform', 'Go']);
  assert.deepEqual(clarifyOf({fit_detail: {gaps: 'Go depth; Salary not stated'}}), ['Go depth', 'Salary not stated']);
  assert.deepEqual([clarifyOf(null), technologiesOf(null), lines(undefined)], [[], [], []]);
  assert.equal(callFacts({call_facts: 'Team size: 8 · Visa/permit: not needed'}), 'Team size: 8 · Visa/permit: not needed');
  assert.deepEqual(nextInterview({next_interview: '2026-10-14T10:00:00'}), {when: shortDay('2026-10-14T10:00:00')});
  assert.equal(nextInterview({}), null);
  assert.equal(foundLine({first_seen_at: '2026-10-09T10:00:00Z'}, {scored: '2026-10-09'}), `First found ${shortDay('2026-10-09T10:00:00Z')} · Scored ${shortDay('2026-10-09')}`);
});

test('Submitted: what was sent, from the frozen record; an edit from the draft is marked; none captured is null', () => {
  const record = {recorded_at: '2026-10-01T09:14:00', job: {applied_on: '2026-10-01', ats: 'greenhouse'}, answers_captured: 'Form',
    answers: [{question: 'Notice', answer: '3 months', draft: '3 months'}, {question: 'Salary', answer: '140k CHF', draft: '140k'}, {question: '', answer: 'x'}],
    cover_letter: ' Dear team ', variant: 'v2', run: {agent: 'claude'}, cv: 'CV.pdf · 3fa8'};
  const sent = submittedOf({[SECTIONS.record]: `Frozen.\n\n### Machine-readable record\n\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``}, {channel: 'Direct'});
  assert.deepEqual(sent.answers, [{question: 'Notice', answer: '3 months', edited: false}, {question: 'Salary', answer: '140k CHF', edited: true}]);
  assert.equal(sent.letter, 'Dear team');
  assert.equal(sent.note, 'Answers read from the form just before Submit.');
  assert.equal(sent.when, shortDay('2026-10-01'));
  assert.deepEqual(sent.facts.map(([label]) => label), ['Recorded', 'Site', 'Channel', 'CV version', 'Kit variant', 'Agent']);
  assert.equal(sent.facts.find(([label]) => label === 'Site')[1], 'Greenhouse');
  assert.equal(submittedOf({}), null, 'no record: nothing was captured');
  assert.equal(submittedOf({[SECTIONS.record]: 'only words'}), null);
  assert.equal(pageParts({sections: {[SECTIONS.record]: `x\n\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``}}).has.application, true);
});

test('a posting as blocks: headings, bullets and paragraphs; a flat old text is cut at sentence ends, by shape', () => {
  assert.deepEqual(postingBlocks('## Responsibilities\n- Run on-call\n- Build automation\n\n## Requirements\nKubernetes.\n\nCHF 130k'),
    [{kind: 'heading', text: 'Responsibilities'}, {kind: 'list', items: ['Run on-call', 'Build automation']}, {kind: 'heading', text: 'Requirements'},
      {kind: 'text', text: 'Kubernetes.'}, {kind: 'text', text: 'CHF 130k'}]);
  assert.deepEqual(postingBlocks('### Cover letter\n\nDear **team**'), [{kind: 'heading', text: 'Cover letter'}, {kind: 'text', text: 'Dear team'}], 'the Markdown sections use the same marks');
  const flat = 'At Swarovski, your ideas are valued. '.repeat(30) + 'About the role Deliver service. Build trust. '.repeat(30);
  const cut = paragraphize(flat);
  assert.ok(cut.split('\n\n').length > 3, 'cut into several paragraphs');
  assert.ok(cut.split('\n\n').every(part => part.length <= 420), 'each short');
  assert.equal(cut.replace(/\n\n/g, ' '), flat.trim(), 'not one word changed');
  assert.equal(paragraphize('Short text. Two sentences.'), 'Short text. Two sentences.', 'a short text is left alone');
  assert.equal(paragraphize('A\nB '.repeat(300)), ('A\nB '.repeat(300)).trim(), 'text with its own lines is left alone');
  assert.deepEqual(postingBlocks(''), []);
});

test('the Description\'s facts and source line: what is known, "Not stated" for the rest', () => {
  const facts = postingFacts({company: 'Helvetic Cloud'}, {source: 'Helvetic Cloud', source_kind: 'employer feed', first_seen_at: '2026-10-09T08:00:00Z', posted_at: ''}, 'one two three');
  assert.deepEqual(facts.map(fact => [fact.key, fact.value, fact.note]), [['employer', 'Helvetic Cloud', 'careers page'], ['posted', 'Not stated', ''],
    ['found', shortDay('2026-10-09T08:00:00Z'), ''], ['saved', 'Saved', '3 words']]);
  assert.equal(postingFacts({}, {}, '')[3].value, 'None');
  assert.equal(postingSource({source: 'Helvetic Cloud', source_kind: 'employer feed'}), 'Job description from careers page (Helvetic Cloud)');
  assert.equal(postingSource({source: 'jobs.ch', source_kind: 'job board'}), 'Job description from job board (jobs.ch)');
  assert.equal(postingSource({}), 'Job description from the search');
});
