// The four shapes a Gmail check's stored message really has (read from Notion, 30 Sep 2026), and the row's result line.
import assert from 'node:assert/strict';
import test from 'node:test';

const {mailChanges, mailResults, mailStatus, parseMailReport, settleQuestion} = await import('../renderer/mail-report.js');

const PREP = [
  '🗓 Tomorrow 08:30 — Huxley — Principal SRE',
  'Follow up Igor / Jaya - SRE',
  'Microsoft Teams Meeting',
  'With: Seosahai - Nejati, Jayantie',
  '🏋️ Answered weakly in past interviews',
  '• Tenure / commitment',
  '• Customer bridge calls',
  '• Non-public-cloud infrastructure and security',
  '📝 Recruiter to follow up on nationality/location constraints and salary expectations, with a further call planned to discuss compensation and contractual setup (B2B vs employee).',
  'Recording? Ask everyone for consent at the start.',
  'Application in Notion (https://app.notion.com/p/Principal-SRE-via-Huxley-3ea62be8fd8681299dd8cc115550b8da)',
].join('\n');

test('a Gmail check tells what it did, in the row\'s own numbers', () => {
  assert.deepEqual(mailStatus('Gmail check: 1 new email(s) read, 0 update(s) recorded'),
    {title: 'Check complete', sentence: '1 email reviewed. No application records changed.', emails: 1, updates: 0});
  assert.deepEqual(mailStatus('Gmail check: 3 new email(s) read, 2 update(s) recorded'),
    {title: 'Check complete', sentence: '3 emails reviewed. 2 application records changed.', emails: 3, updates: 2});
  assert.deepEqual(mailStatus('Gmail check: 0 new email(s) read, 0 update(s) recorded'),
    {title: 'Check complete', sentence: 'No new job emails, and no application records changed.', emails: 0, updates: 0});
  assert.deepEqual(mailStatus(''), {title: 'Check complete', sentence: '', emails: null, updates: null});  // nothing to claim
});

test('the prep message becomes the interview, its topics, the next step and the consent line', () => {
  const report = parseMailReport(PREP, 'Gmail check: 1 new email(s) read, 0 update(s) recorded');
  assert.equal(report.status.sentence, '1 email reviewed. No application records changed.');
  assert.deepEqual(report.interview, {
    when: 'Tomorrow 08:30', company: 'Huxley', title: 'Principal SRE',
    summary: 'Follow up Igor / Jaya - SRE', where: 'Microsoft Teams Meeting',
    people: ['Seosahai - Nejati', 'Jayantie'],
  });
  assert.deepEqual(report.topics, ['Tenure / commitment', 'Customer bridge calls', 'Non-public-cloud infrastructure and security']);
  assert.deepEqual(report.nextSteps, [  // the pipeline's own clause boundary is where the paragraphs break
    'Recruiter to follow up on nationality/location constraints and salary expectations.',
    'With a further call planned to discuss compensation and contractual setup (B2B vs employee).',
  ]);
  assert.equal(report.consent, 'Recording? Ask everyone for consent at the start.');
  assert.equal(report.url, 'https://app.notion.com/p/Principal-SRE-via-Huxley-3ea62be8fd8681299dd8cc115550b8da');
  assert.deepEqual(report.notes, []);  // every line found its place
});

test('the other three shapes are notes, and none of them is read as an interview', () => {
  const nudge = parseMailReport('🎤 How did Huxley — Principal SRE go? Send the transcript (or /interview with your notes) with the caption ", Connect Igor / Jaya - SRE" for a review.', 'Gmail check: 5 new email(s) read, 1 update(s) recorded');
  assert.equal(nudge.interview, null);
  // fromRow marks where the line came from: a report line is drawn as the card's own structured section, never as a note.
  assert.deepEqual(nudge.notes, [{icon: '🎤', text: 'How did Huxley — Principal SRE go? Send the transcript (or /interview with your notes) with the caption ", Connect Igor / Jaya - SRE" for a review.', fromRow: false}]);

  const calendar = parseMailReport([
    '📧 Job emails and calendar',
    '❓ Huxley — SRE: an interview, but which job? Add the details in Job Pilotto (Focus → Add details: paste the LinkedIn chat or the job link).',
    '🗓 Huxley — SRE: Teams meeting scheduled with recruiter Jayantie Nejati · Wed 30 Sep 08:30',
  ].join('\n'), 'Gmail check: 3 new email(s) read, 2 update(s) recorded');
  assert.equal(calendar.interview, null);                     // a colon after the company, not " — " around the title
  assert.equal(calendar.notes.length, 3);
  assert.equal(calendar.notes[1].icon, '❓');
  assert.match(calendar.notes[1].text, /^Huxley — SRE: an interview/);

  const quiet = parseMailReport('📧 Gmail checked: no new job emails.', 'Gmail check: 0 new email(s) read, 0 update(s) recorded');
  assert.equal(quiet.status.sentence, 'No new job emails, and no application records changed.');
  assert.deepEqual(quiet.notes, [{icon: '📧', text: 'Gmail checked: no new job emails.', fromRow: false}]);
  assert.equal(parseMailReport('', ''), null);
  assert.equal(parseMailReport(null, null), null);
});

test('a missing link or missing people does not invent them', () => {
  const bare = parseMailReport([
    '🗓 Today 14:00 — Basler Kantonalbank — Software Engineer',
    'Interview with the team',
  ].join('\n'), '');
  assert.deepEqual(bare.interview, {
    when: 'Today 14:00', company: 'Basler Kantonalbank', title: 'Software Engineer',
    summary: 'Interview with the team', where: '', people: [],
  });
  assert.equal(bare.url, '');
  assert.equal(bare.consent, '');
  assert.equal(bare.status.sentence, '');
});

// A check that sent nothing to Telegram (no update worth telling you about, or Telegram off) has no message: its
// Notion report lines are then the only account of what it did — and those now name what it changed.
test('without a message the report lines say what the check recorded and changed', () => {
  const row = ['Gmail check: 2 new email(s) read, 1 update(s) recorded; AI cost $0.004.',   // the status already says this
               '📬 Application received · Canonical — Software Engineer - Data Infrastructure · Stage Applied → Confirmation received',
               'Emails with claude-haiku-4-5: 2 of 2; tokens in 3252 (+0 cached), out 142; $0.0040'];  // not about the emails
  const report = parseMailReport(null, 'Gmail check: 2 new email(s) read, 1 update(s) recorded', row);
  assert.deepEqual(report.status, {title: 'Check complete', sentence: '2 emails reviewed. 1 application record changed.', emails: 2, updates: 1});
  // The update is its own line — the job, and what moved on it — not a note.
  assert.deepEqual(report.updates, [{summary: 'Application received', job: 'Canonical — Software Engineer - Data Infrastructure',
                                     changes: 'Stage Applied → Confirmation received'}]);
  // The run's own lines are marked, so the card can draw them as sections instead of as loose text.
  assert.ok(report.notes.every(note => note.fromRow));
  assert.equal(parseMailReport(null, '', []), null);  // no message and no report: nothing to draw
});

// The two lines src/notion/cron_runs.py writes about the emails, as the card reads them.
test('each email read becomes a row: subject, who sent it, when, what was done with it', () => {
  const row = ['Gmail check: 2 new email(s) read, 1 update(s) recorded; AI cost $0.004.',
               '📬 Application received · Canonical — Software Engineer - Data Infrastructure · Stage Applied → Confirmation received; Confirmation email set',
               'Security code for your application to Canonical · Greenhouse · 01 Oct 03:44 — [read] · Canonical · nothing to record',
               'Thank you for applying to Canonical · us.greenhouse-mail.io · 01 Oct 03:45 — [recorded] · Canonical — Software Engineer - Data Infrastructure · changed Stage Applied → Confirmation received; Confirmation email set'];
  const report = parseMailReport(null, '', row);
  assert.deepEqual(report.updates, [{summary: 'Application received', job: 'Canonical — Software Engineer - Data Infrastructure',
                                     changes: 'Stage Applied → Confirmation received; Confirmation email set'}]);
  assert.deepEqual(report.emails, [
    {subject: 'Security code for your application to Canonical', sender: 'Greenhouse', time: '01 Oct 03:44',
     action: 'read', by: 'Canonical', changes: 'nothing to record'},
    {subject: 'Thank you for applying to Canonical', sender: 'us.greenhouse-mail.io', time: '01 Oct 03:45',
     action: 'recorded', by: 'Canonical — Software Engineer - Data Infrastructure',
     changes: 'Stage Applied → Confirmation received; Confirmation email set'}]);
});

// "Stage Applied → Confirmation received; Confirmation email set" as the card's two pills. A bug here showed the
// first pill as "[object HTMLElement], → Confirmation received" (an array handed to el(), which takes one node or
// text), so the split is its own tested function now.
test('one update change becomes a movement and a flag', () => {
  assert.deepEqual(mailChanges('Stage Applied → Confirmation received; Confirmation email set'),
    [{from: 'Stage Applied', to: 'Confirmation received'}, {flag: 'Confirmation email set'}]);
  assert.deepEqual(mailChanges('Next interview Thu 01 Oct 12:30 → Fri 02 Oct 09:00'),
    [{from: 'Next interview Thu 01 Oct 12:30', to: 'Fri 02 Oct 09:00'}]);
  assert.deepEqual(mailChanges(''), []);
});

test('an email that is not about the applications is not listed, older runs included', async () => {
  const {parseMailLines} = await import('../renderer/mail-report.js');
  const record = parseMailLines(['summary',
    'Your receipt from Anthropic Ireland, Limited #2695-4622 · Anthropic Ireland, Limited · 02 Oct 02:31 — [not about your applications]',
    'Thank you for applying · us.greenhouse-mail.io · 01 Oct 02:56 — [recorded] · Canonical — SRE · changed Stage Applied → Confirmation received']);
  assert.deepEqual(record.emails.map(email => email.action), ['recorded']);
});

test('a "which job?" line reads as answered once Focus no longer holds the question', () => {
  const open = [{headline: 'Blockdaemon: Meeting invitation', detail: 'Invitation from an unknown sender'}];
  assert.equal(settleQuestion('Blockdaemon — which job?', open), 'Blockdaemon — which job?');
  assert.equal(settleQuestion('Blockdaemon — which job?', []), 'Blockdaemon — which job? Answered in Focus');
  assert.equal(settleQuestion('Interview scheduled · Blockdaemon — which job?'.replace('Interview scheduled · ', ''), []), 'Blockdaemon — which job? Answered in Focus');
  assert.equal(settleQuestion('Blockdaemon: Meeting invitation … which job? Answer in Job Pilotto (Focus).', []), 'Blockdaemon — which job? Answered in Focus');
  assert.equal(settleQuestion('Blockdaemon — which job?', null), 'Blockdaemon — which job?');   // Focus not loaded: no judgement
  assert.equal(settleQuestion('Canonical — SRE', []), 'Canonical — SRE');
});

test('a "which job?" stays an update (a side effect) and the email that raised it is told apart by its action', () => {
  const report = parseMailReport('', 'Gmail check: 2 new email(s) read, 2 update(s) recorded', [
    'Gmail check: 2 new email(s) read, 2 update(s) recorded',
    '📬 Application received · Canonical — SRE · Stage Applied → Confirmation received',
    '❓ Interview scheduled · Blockdaemon — which job?',
    'Meeting invitation · Cal.com · 02 Oct 21:30 — [needs you] · Blockdaemon']);
  assert.deepEqual(report.updates.map(update => update.job), ['Canonical — SRE', 'Blockdaemon — which job?']);
  assert.equal(report.emails[0].action, 'needs you');
});

// The check of 5 Oct 2026 (the owner's screenshot): one email read, the rejection it recorded, and the AI's reading of it.
test('a rejection becomes the email\'s result: the update, its stage, and the AI assessment split in two', () => {
  const message = ['📧 Job emails & calendar', '2 updates', '',
    'Anthropic · Staff+ Software Engineer, Data Infrastructure · Rejected', 'Application rejected after consideration', '',
    '🛠 Why rejected · Anthropic — Staff+ Software Engineer, Data Infrastructure: Hard skills (medium). Staff-level data-infrastructure role needing a deep data/storage background (BigQuery, Airflow, dbt, Spark); your experience is SRE/platform.'].join('\n');
  const rows = ['Gmail check: 1 new email(s) read, 2 update(s) recorded',
    'Anthropic Follow-Up for Staff+ Software Engineer, Data Infrastructure | Igor · us.greenhouse-mail.io · 05 Oct 21:50 — [recorded] · Anthropic — Staff+ Software Engineer, Data Infrastructure'];
  const report = parseMailReport(message, rows[0], rows);
  assert.deepEqual(report.notes.filter(note => !note.fromRow), []);   // nothing left to draw as loose text (the card skips row lines)
  const {results, updates} = mailResults(report);
  assert.equal(results.length, 1);
  assert.deepEqual(updates, []);
  const [result] = results;
  assert.deepEqual([result.company, result.role, result.email.sender, result.email.time],
    ['Anthropic', 'Staff+ Software Engineer, Data Infrastructure', 'us.greenhouse-mail.io', '05 Oct 21:50']);
  assert.deepEqual([result.outcome.kind, result.outcome.summary], ['Rejected', 'Application rejected after consideration']);
  assert.deepEqual([result.assessment.verdict, result.assessment.confidence, result.assessment.focus, result.assessment.background],
    ['Hard skills', 'medium', 'Staff-level data-infrastructure role needing a deep data/storage background (BigQuery, Airflow, dbt, Spark).', 'SRE/platform.']);
});

test('an assessment with no "your experience" clause stays one sentence, and an unmatched update gets its own card', () => {
  const report = parseMailReport(['Acme · SRE · Rejected', 'No reason given', '',
    '❔ Why rejected · Acme — SRE: Unclear (low). The email gave no reason.'].join('\n'), 'Gmail check: 0 new email(s) read, 1 update(s) recorded', []);
  const [result] = mailResults(report).results;
  assert.equal(result.email, null);
  assert.deepEqual([result.company, result.role, result.assessment.focus, result.assessment.summary], ['Acme', 'SRE', '', 'The email gave no reason.']);
});
