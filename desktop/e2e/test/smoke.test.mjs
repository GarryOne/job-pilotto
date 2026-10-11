// The hand-started smoke's logic (lib/smoke.mjs): how far a live run got, what counts as a regression, which posting a run tries, which shapes it takes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {APPLY_BY_EMAIL, LOGIN_WALL, PAGE_TELLS, SITE_REFUSED, compare, engineLine, fieldLines, marksBlind, parseLive, pickPosting, placeFound, rungFields, runShare, shareSize, shortfall, smokeEngine, verdictFields, verdictOf} from '../lib/smoke.mjs';

const LIVE = `  live 0s: Apply pressed on https://www.jobs.ch/en/vacancies/detail/x/
  2026-10-10T12:20:27Z [extension] page kind: account {"shape":"auth.jobs.ch/u/login/identifier|1-2","by":"ai"}
  2026-10-10T12:20:34Z [extension] fill: fields: 1 filled, 1 left {"fields":[]} account page
  2026-10-10T12:20:46Z [extension] account judgment result: needs_code {"botCheck":false}`;

test('a run that stopped at the email code reached code/bot; an account page\'s fields are not the form', () => {
  assert.deepEqual(parseLive(LIVE), {reached: 'code/bot', filled: null, left: null, rung: 2, signal: null, fieldList: [], marks: null, pageKindErrors: [], kinds: ['account'], path: [{kind: 'account', host: 'auth.jobs.ch'}], errors: []});
});

test('a form filled to the end is ready; one with fields left is form', () => {
  assert.equal(parseLive('Apply pressed on u\n[extension] page kind: form {}\n[extension] fill: fields: 9 filled, 0 left').reached, 'ready');
  assert.deepEqual(parseLive('Apply pressed on u\n[extension] fill: fields: 6 filled, 3 left').reached, 'form');
});

test('a regression: an earlier step than last time, or fewer fields on the same posting; a new shape is not one', () => {
  const before = {signin: {reached: 'code/bot', url: 'a'}, form: {reached: 'form', filled: 9, url: 'b'}};
  const now = {signin: {reached: 'posting', url: 'a'}, form: {reached: 'form', filled: 7, url: 'b'}, fresh: {reached: 'none', url: 'c'}};
  assert.deepEqual(compare(before, now).map(item => item.shape), ['signin', 'form']);
  assert.deepEqual(compare(before, {signin: {reached: 'form', url: 'a'}}), []);
});

test('postings rotate by day', () => {
  const day = n => new Date(n * 86400000);
  assert.deepEqual([pickPosting(['https://a.example/1', 'https://b.example/2', 'https://c.example/3'], day(0)), pickPosting(['https://a.example/1', 'https://b.example/2', 'https://c.example/3'], day(1))], ['https://a.example/1', 'https://b.example/2']);
  assert.deepEqual([pickPosting(['a', 'b', 'c'], day(0)), pickPosting(['a', 'b', 'c'], day(1)), pickPosting(['a', 'b', 'c'], day(3))], ['a', 'b', 'a']);
  assert.equal(pickPosting([]), null);
});

test('postings of a shape come read-only from the job list, quotes in a pattern cannot break the query', async () => {
  const {postingsLike} = await import('../smoke.mjs');
  let asked;
  const rows = postingsLike(["%jobs.ch%", "%o'brien%"], (cmd, args) => { asked = [cmd, args]; return 'https://www.jobs.ch/a\tEngineer\tAcme\nhttps://www.jobs.ch/b\tAnalyst\tBeta\n'; });
  assert.deepEqual(rows.map(row => row.url), ['https://www.jobs.ch/a', 'https://www.jobs.ch/b']);
  assert.equal(asked[0], 'sqlite3');
  assert.ok(asked[1].includes('-readonly'));
  assert.match(asked[1].at(-1), /like '%o''brien%'/);
});

test('a gone posting (404/410) is noted, and a note is never a regression', async () => {
  const {postingStatus} = await import('../smoke.mjs');
  assert.equal(await postingStatus('https://x.example/job', async () => ({status: 410})), 410);
  assert.equal(await postingStatus('https://x.example/job', async () => { throw new Error('offline'); }), 0);
  assert.deepEqual(compare({a: {reached: 'form', url: 'u'}}, {a: {reached: 'none', url: 'u', note: 'posting gone (HTTP 404)'}}), []);
});

test('the public site list holds only fixed job-feed postings: a profile\'s own jobs live in the app\'s folder, never in this repo', async () => {
  const fs = await import('node:fs');
  const {shapes} = JSON.parse(fs.readFileSync(new URL('../smoke-sites.json', import.meta.url), 'utf8'));
  assert.ok(shapes.length >= 5);
  for (const shape of shapes) { assert.equal(shape.like, undefined, `${shape.shape}: a job-list query belongs in the local list`); assert.ok(shape.urls?.length, shape.shape); }
  const {LOCAL_SITES} = await import('../smoke.mjs');
  assert.ok(!LOCAL_SITES.includes('/desktop/e2e/'), 'the local list is outside the repo');
  assert.ok(!/Job Pilotto\/smoke-sites/.test(LOCAL_SITES), 'and outside the app\'s folder, which a profile reset wipes');
});

test('each shape is compared with its own last run, however long ago', async () => {
  const {lastSeen} = await import('../lib/smoke.mjs');
  const seen = lastSeen([{day: '2026-10-01', results: {a: {reached: 'form'}, b: {reached: 'account'}}}, {day: '2026-10-05', results: {a: {reached: 'posting'}}}]);
  assert.deepEqual([seen.a.reached, seen.a.day, seen.b.reached, seen.b.day], ['posting', '2026-10-05', 'account', '2026-10-01']);
});

test('a flow signature: page kinds in order and the host the journey ended on; one signature per distinct flow', async () => {
  const {signature} = await import('../lib/smoke.mjs');
  const run = parseLive(`Apply pressed on u
  [extension] fill: page kind: posting {"by":"ai","host":"www.jobs.ch"}
  [extension] fill: page kind: posting {"by":"remembered","host":"www.jobs.ch"}
  [extension] fill: page kind: account {"by":"ai","host":"apply.deloitte.ch"}
  [extension] account judgment result: needs_code {"botCheck":false}`);
  assert.deepEqual(run.path, [{kind: 'posting', host: 'www.jobs.ch'}, {kind: 'account', host: 'apply.deloitte.ch'}]);
  assert.equal(signature(run), 'posting>account@apply.deloitte.ch#code/bot');
  assert.equal(signature({reached: 'none'}), 'unclear');
  assert.equal(signature({reached: 'posting', path: []}), 'unclear');
});

test('discovery candidates: a few per host, more from job boards, none already in the pool', async () => {
  const {candidates} = await import('../lib/smoke.mjs');
  const jobs = [...Array.from({length: 20}, (_, i) => ({url: `https://www.jobs.ch/en/vacancies/detail/${i}/`})), ...Array.from({length: 5}, (_, i) => ({url: `https://career.hm.com/job/${i}`}))];
  const picked = candidates(jobs, new Set(['https://career.hm.com/job/0']));
  assert.equal(picked.filter(item => item.url.includes('jobs.ch')).length, 12);
  assert.deepEqual(picked.filter(item => item.url.includes('hm.com')).map(item => item.url), ['https://career.hm.com/job/1', 'https://career.hm.com/job/2']);
});

test('never an automated visit to LinkedIn, Glassdoor, Indeed, levels.fyi or Reddit: not a discovery candidate, not picked by a pool run', async () => {
  const {candidates, mayVisit} = await import('../lib/smoke.mjs');
  for (const url of ['https://ch.indeed.com/viewjob?jk=1', 'https://www.linkedin.com/jobs/view/1', 'https://www.glassdoor.ch/job/1', 'https://www.levels.fyi/jobs', 'https://www.reddit.com/r/jobs']) assert.equal(mayVisit(url), false, url);
  assert.equal(mayVisit('https://career.hm.com/job/1'), true);
  assert.deepEqual(candidates([{url: 'https://ch.indeed.com/viewjob?jk=1'}, {url: 'https://career.hm.com/job/1'}]).map(item => item.url), ['https://career.hm.com/job/1']);
  assert.equal(pickPosting([{url: 'https://ch.indeed.com/viewjob?jk=1'}]), null);
});

test('a discovered flow names the employer, and fills a never-run shape of the same host instead of adding a duplicate', () => {
  const shapes = [{shape: 'Richemont Workday', urls: ['https://richemont.wd3.myworkdayjobs.com/a']}, {shape: 'Known', urls: ['https://x.com/1'], signature: 'form@x.com#ready'}];
  placeFound(shapes, {url: 'https://richemont.wd3.myworkdayjobs.com/b', company: 'Richemont'}, 'posting@richemont.wd3.myworkdayjobs.com#posting', '2026-10-10');
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0].signature, 'posting@richemont.wd3.myworkdayjobs.com#posting');
  placeFound(shapes, {url: 'https://jobs.ashbyhq.com/c/1', company: 'Acme'}, 'form@jobs.ashbyhq.com#form', '2026-10-10');
  assert.equal(shapes[2].shape, 'Acme (found 2026-10-10)');
  placeFound(shapes, {url: 'https://x.com/2'}, 'other@x.com#form', '2026-10-10');   // same host but already run: a new shape, named by host
  assert.equal(shapes[3].shape, 'x.com (found 2026-10-10)');
});

const FORM = `  live 0s: Apply pressed on https://jobs.example.com/o/x
  2026-10-10T19:21:09Z [extension] page kind: form {"by":"ai","host":"jobs.example.com"}
  2026-10-10T19:21:10Z [extension] fill: fields: 2 filled, 3 left {"fields":[{"label":"Full name","type":"text","outcome":"filled"
      field filled text "Full name" required=true reason=your details
      field filled email "Email address" required=true reason=your details
      field left text "How did you find out about us?" required=true reason=no answer known
      field left radio "Work permit" required=true reason=knockout question
      field left file "Cover letter" required=false reason=optional`;

test('a form run keeps each field with its outcome, requirement and reason (the line in the log is cut at 230 characters, so the runner prints them one per line)', () => {
  const result = parseLive(FORM);
  assert.equal(result.fieldList.length, 5);
  assert.deepEqual(result.fieldList[2], {outcome: 'left', type: 'text', label: 'How did you find out about us?', required: true, reason: 'no answer known'});
  assert.equal(result.fieldList[4].required, false);
});

test('the fields line the app writes (far longer than 230 characters) becomes one line per field that parseLive reads back', () => {
  const fields = Array.from({length: 12}, (_, i) => ({label: `Question number ${i} about something long enough`, type: i % 2 ? 'radio' : 'text', outcome: i < 4 ? 'filled' : 'left', required: i !== 11, source: 'your details', reason: i < 4 ? '' : 'no answer known'}));
  const line = `2026-10-10T19:21:10.153Z [extension] fill: fields: 4 filled, 8 left ${JSON.stringify({fields})}`;
  assert.ok(line.length > 1000);
  const lines = fieldLines(line);
  assert.equal(lines.length, 12);
  const back = parseLive(['  live 0s: Apply pressed on https://x/', '  l [extension] page kind: form {"host":"x"}', '  l [extension] fill: fields: 4 filled, 8 left {"fields":[', ...lines].join('\n'));
  assert.equal(back.fieldList.length, 12);
  assert.equal(back.fieldList[11].required, false);
  assert.equal(shortfall(back).total, 11);   // the 11 asked fields (the 12th is optional)
  assert.deepEqual(fieldLines('fill: fields: 1 filled, 1 left {"fields":[]} account page'), []);   // an account page's fields are not the form's
  assert.deepEqual(fieldLines('fill: fields: 4 filled, 8 left {"fields":[{"label":"Full name","type"'), []);   // a cut line gives none, never a wrong one
});

// The AI ladder (docs/flows/ladder.md): the rung that made the run's last decision, read from the log; /admin/applying shows it as "Rung" (rung 0 to 6, signal unsure|contradicted|stalled|failed).
const rungOf = text => { const {rung, signal} = parseLive(text); return [rung, signal]; };
test('parseLive: the rung of the last decision comes from how the page kind was decided', () => {
  assert.deepEqual(rungOf('x [extension] page kind: posting {"by":"ai"}'), [2, null]);
  assert.deepEqual(rungOf('x [extension] page kind: posting {"by":"remembered"}'), [1, null]);
  assert.deepEqual(rungOf('x [extension] page kind: posting {"by":"structure rule"}'), [0, null]);
  assert.deepEqual(rungOf('x [extension] page kind: none (no answer), the structure rule decides {"by":""}'), [0, null]);
  assert.deepEqual(rungOf('x [extension] page kind: posting {"by":"ai"}\nx [extension] page kind: form {"by":"remembered"}'), [1, null]);   // the last decision wins
});
test('parseLive: a closer look is rung 4, a Claude takeover rung 5', () => {
  assert.deepEqual(rungOf('x [extension] page kind: account {"by":"ai"}\nx [extension] closer look: click (the Continue button) {"by":"ai"}'), [4, null]);
  assert.deepEqual(rungOf('x [extension] closer look: click (x)\nx [extension] take over with Claude asked from the page {"host":"a.com"}'), [5, null]);
  assert.deepEqual(rungOf('x [extension] take over with Claude refused: Claude already took over this application (one per application)\nx [extension] page kind: posting {"by":"ai"}'), [2, null]);   // refused: nothing took over
});
test('parseLive: the exact line "ladder: rung N signal S" overrides, and an unknown rung stays null', () => {
  assert.deepEqual(rungOf('x [extension] page kind: posting {"by":"ai"}\nx [extension] ladder: rung 3 signal unsure'), [3, 'unsure']);
  assert.deepEqual(rungOf('x [extension] ladder: rung 2 signal contradicted\nx [extension] page kind: form {"by":"remembered"}'), [2, 'contradicted']);   // the app's own line wins over a derived rung
  assert.deepEqual(rungOf('x [extension] ladder: rung 9 signal unsure'), [null, null]);
  assert.deepEqual(rungOf('x [extension] ladder: rung 3 signal because'), [3, null]);
  assert.deepEqual(rungOf('Apply pressed on https://a.com/x'), [null, null]);
});
test('rungFields: the upload row carries a known rung and signal, nothing for an unknown one', () => {
  assert.deepEqual(rungFields({rung: 0, signal: null}), {rung: 0});
  assert.deepEqual(rungFields({rung: 3, signal: 'stalled'}), {rung: 3, signal: 'stalled'});
  assert.deepEqual(rungFields({rung: null, signal: null}), {});
  assert.deepEqual(rungFields(undefined), {});
});

test('marks blind: more "*" labels than required questions counted means the required rule missed a layout', () => {
  const run = (starred, required) => parseLive(`  live + 9s: x\n      log 19:03:13.8Z [review] fill: marks: ${starred} starred, ${required} required {"board":"recruitingapp-662.umantis.com"}`);
  assert.deepEqual(marksBlind(run(12, 0)), {starred: 12, required: 0});   // the umantis form of 10 Oct 2026: six starred questions, none counted
  assert.equal(marksBlind(run(12, 11)), null);   // the rule saw them
  assert.equal(marksBlind(run(2, 0)), null);   // too few marks to say
  assert.equal(marksBlind(parseLive('nothing')), null);   // an old app logs no marks line
});

// The owner's test for a left field (10 Oct 2026): did we really not know it, and did we suggest an answer? Both yes: expected. The reasons are the extension's own fixed texts.
const left = (reason, type = 'text', required = true) => ({outcome: 'left', type, label: 'Q', required, reason});
const NO_ANSWER = 'no answer in the kit, Profile or your details';

test('a left field is expected when a suggestion was shown or the choice is the person\'s; a miss when the extension failed; no suggestion when nothing was proposed', () => {
  assert.equal(verdictOf({outcome: 'filled', type: 'text', reason: 'your details'}), 'filled');
  assert.equal(verdictOf(left('proposed for you to confirm')), 'expected');
  assert.equal(verdictOf(left('legal/consent: always your choice', 'checkbox')), 'expected');
  assert.equal(verdictOf(left(NO_ANSWER)), 'no_suggestion');
  assert.equal(verdictOf(left(NO_ANSWER), {aiOff: true}), 'unknown');   // the AI was not asked: no suggestion could exist
  assert.equal(verdictOf(left('answer given, but the field did not take it')), 'miss');
  assert.equal(verdictOf(left('question text not found on the page', 'radio')), 'miss');
});

test('a form is a shortfall when any asked field is unexplained, not when under half is filled', () => {
  const form = fieldList => ({reached: 'form', filled: 1, left: 1, fieldList});
  const filled = {outcome: 'filled', type: 'text', label: 'Name', required: true, reason: 'your details'};
  assert.equal(shortfall(form([filled, left('proposed for you to confirm'), left('legal/consent: always your choice', 'checkbox')])), null);   // everything left is expected: ok, however little is filled
  assert.deepEqual(shortfall(form([filled, left(NO_ANSWER), left('answer given, but the field did not take it')])), {done: 1, total: 3, miss: 1, noSuggestion: 1});
  assert.equal(shortfall(form([filled, left(NO_ANSWER, 'text', false)])), null);   // an optional field is not asked
  assert.equal(shortfall(form([filled, left(NO_ANSWER)]), {aiOff: true}), null);   // no AI, so no suggestion could exist: not judged
  assert.deepEqual(shortfall({reached: 'form', filled: 4, left: 8}), {done: 4, total: 12, miss: 0, noSuggestion: 0});   // no field list (an old run): the counts, under half
  assert.equal(shortfall({reached: 'form', filled: 6, left: 6}), null);
  assert.equal(shortfall({reached: 'posting'}), null);
});

// An eligibility stop is deliberate (parseLive's note): the fields it left wait for a person, not a fill fix. Its first pass's fields are logged since 11 Oct 2026,
// so a stopped form now has a field list and would otherwise read as a shortfall.
// The fill's verdict line (extension/eligibility-verdict.js): the AI's own verdict and who passed a "no", so "judged eligible" is told from "eligibility skipped".
test('a run keeps the AI\'s own eligibility verdict and what passed a "not eligible"', () => {
  const kit = parseLive('      log 16:01:02.000Z [extension] fill: filled the form {"ineligible":false,"aiEligible":false,"forced":"kit","url":"x"}');
  assert.deepEqual(kit.verdict, {aiEligible: false, forced: 'kit'});
  assert.deepEqual(parseLive('      log 16:01:02.000Z [extension] fill: filled the form {"ineligible":false,"aiEligible":true,"forced":"","url":"x"}').verdict, {aiEligible: true, forced: ''});
  assert.equal(parseLive('      log 16:01:02.000Z [extension] fill: filled the form {"ineligible":false,"url":"x"}').verdict, undefined, 'an older extension says nothing: no verdict invented');
});

test('a form stopped by the eligibility check is not a shortfall', () => {
  const stop = ['      log 15:38:26.235Z [extension] fill: first fields filled {"fields":4}', '      log 15:38:32.019Z [extension] fill: did not fill: The role is in Sydney. {"url":"x"}',
    '      log 15:38:32.020Z [extension] fill: fields: 4 filled, 2 left {"fields":[]}', '      field filled text "First name" required=true reason=',
    `      field left text "Why us?" required=true reason=${NO_ANSWER}`].join('\n');
  const result = parseLive(stop);
  assert.equal(result.filled, 4);
  assert.match(result.note, /^eligibility stop: /);
  assert.equal(shortfall(result), null);
  assert.ok(shortfall({...result, note: ''}), 'the same fields without the stop are a shortfall');
});

test('the upload carries the verdict only for a form reached with a field list: how many fields were asked and how many are unexplained', () => {
  const filled = {outcome: 'filled', type: 'text', label: 'Name', required: true, reason: 'your details'};
  assert.deepEqual(verdictFields({reached: 'form', filled: 1, left: 2, fieldList: [filled, left('proposed for you to confirm'), left(NO_ANSWER)]}), {asked: 3, unexplained: 1});
  assert.deepEqual(verdictFields({reached: 'form', filled: 1, left: 1, fieldList: [filled, left('proposed for you to confirm')]}), {asked: 2, unexplained: 0});
  assert.deepEqual(verdictFields({reached: 'form', fieldList: []}), {});   // an old run: no verdict, the page counts
  assert.deepEqual(verdictFields({reached: 'posting', fieldList: [filled]}), {});
});

test('the app\'s page-kind answers with no kind keep their error words, and the ladder\'s own log lines give the rung (3 digest, 4 closer look, 6 the person)', () => {
  const log = lines => parseLive(['  live 0s: Apply pressed on https://x/', ...lines.map(line => `      log 20:00:00.000Z [extension] ${line}`)].join('\n'));
  const none = log(['page kind: none (usage limit reached: try again later)', 'page kind: none (usage limit reached: try again later)']);
  assert.deepEqual(none.pageKindErrors, ['usage limit reached: try again later']);   // said once, with the AI\'s own words
  assert.equal(none.rung, 0);   // no answer: the structure rule decided
  assert.equal(log(['fill: pressed the control the digest named {"label":"Apply"}']).rung, 3);
  assert.equal(log(['fill: the page tells what to do {"how":"email"}']).rung, 3);
  assert.equal(log(['fill: closer look: click {"host":"x"}']).rung, 4);
  assert.equal(log(['page kind: posting {"by":"digest"}', 'fill: the ladder ended at the person']).rung, 6);   // the last decision wins
  assert.deepEqual(log(['page kind: posting {"by":"ai"}']).pageKindErrors, []);
});

test('a smoke row runs on the app\'s own path without Electron by default; SMOKE_ELECTRON=1 (or SMOKE_NO_ELECTRON=0) is the way back to the Electron app', () => {
  assert.equal(smokeEngine({}), 'node', 'the default (owner, 11 Oct 2026: ~35-65 s instead of 69-97 s a row, no 27 s app start)');
  assert.equal(smokeEngine({SMOKE_NO_ELECTRON: '1'}), 'node');
  assert.equal(smokeEngine({SMOKE_ELECTRON: '1'}), 'electron');
  assert.equal(smokeEngine({SMOKE_NO_ELECTRON: '0'}), 'electron');
  assert.match(engineLine('node'), /without Electron.*SMOKE_ELECTRON=1/);
  assert.match(engineLine('electron'), /Electron app/);
});

test('a run\'s share is the shapes least recently run (never run first), never one twice before every shape ran once; no calendar day', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(runShare(pool, 2, {}), ['a', 'b'], 'nothing run yet: the pool\'s own order');
  const seen = {a: {day: '2026-10-11'}, b: {day: '2026-10-11'}, c: {day: '2026-10-09'}};
  assert.deepEqual(runShare(pool, 3, seen), ['d', 'e', 'c'], 'never run first, then the oldest');
  let ran = {};
  const picked = [];
  for (let run = 0; run < 3; run++) { const share = runShare(pool, 2, ran); picked.push(...share); for (const shape of share) ran = {...ran, [shape]: {day: `2026-10-11T0${run}`}}; }
  assert.deepEqual(picked.slice(0, 5).sort(), pool, 'every shape once before any shape twice');
  assert.deepEqual(runShare(pool, 10, {}), pool, 'a share bigger than the pool is the pool');
  assert.equal(shareSize({SMOKE_SHARE: '4'}), 4);
  assert.equal(shareSize({SMOKE_PER_NIGHT: '6'}), 6, 'the old name still works');
  assert.equal(shareSize({}), 10);
});

// Each line that proves the form was reached, with or without a "fields:" line after it (Teamtailor, 11 Oct 2026: the form came, the fill's AI judged the fake applicant
// ineligible, no "fields:" line followed, and the run was scored "posting"). An eligibility stop keeps its reason as the run's note: the pool shows it, not a fill failure.
test('parseLive: a form that came after the press, or an eligibility stop on it, reached the form; the stop is noted with its reason', () => {
  const pressed = '  live +  0s: Apply pressed on https://career.teamtailor.com/jobs/1\n      log 14:55:25.382Z [extension] page kind: posting {"shape":"career.teamtailor.com/jobs/*|0","by":"ai"}\n      log 14:55:25.416Z [extension] fill: pressed the Apply button {"label":"Apply for this job"}';
  const proofs = {
    'a form came': '      log 14:55:26.431Z [extension] fill: after the press: a form came {"host":"career.teamtailor.com","label":"Apply for this job"}',
    'an eligibility stop': '      log 14:55:32.156Z [extension] fill: did not fill: The role requires being based in Sydney, Australia (hybrid). The profile places the applicant in Zurich {"ineligible":true,"url":"https://career.teamtailor.com/jobs/1"}',
    'an eligibility stop cut at 230 characters': `      log 14:55:32.156Z [extension] fill: did not fill: ${'The role requires being based in Sydney. '.repeat(6)}`,
  };
  assert.equal(parseLive(pressed).reached, 'posting', 'the press alone is the posting');
  for (const [name, line] of Object.entries(proofs)) {
    const result = parseLive(`${pressed}\n${line}`);
    assert.equal(result.reached, 'form', name);
    assert.equal(result.filled, null, `${name}: no fields counted`);
    if (/eligibility/.test(name)) assert.match(result.note, /^eligibility stop: The role requires being based in Sydney/, name);
    else assert.equal(result.note, undefined, `${name}: nothing to note`);
  }
  assert.equal(parseLive(`${pressed}\n${proofs['a form came']}\n      log x [extension] fill: fields: 6 filled, 3 left {}`).reached, 'form', 'a fill after it still counts as before');
  assert.equal(parseLive(`${pressed}\n      log x [extension] fill: after the press: no form came {}`).reached, 'posting', 'no form came is no form');
});

// Account-first sites (owner, 11 Oct 2026: a documented hold): a sign-up page before the application is filled like a form, but the test never presses its account
// button, so the run ends there. The account step is the extension's own page-kind decision (the AI's), never a site name or the page's words. Hornbach's 8 filled
// of 11 were the sign-up page (e-mail, password boxes), shown on the Fixed tab as the application's "73%".
const SIGN_UP = ['  live +  0s: Apply pressed on https://jobs.example.com/job/1/',
  '      log 22:06:36.550Z [extension] page kind: posting {"shape":"jobs.example.com/job/*|1-2","by":"ai","rung":2}',
  '      log 22:06:47.090Z [extension] fill: account page: register {"host":"career.example.eu","mode":"sign-up","step":"sign_in"}',
  '      log 22:06:50.334Z [extension] fill: page kind: account {"by":"ai","confidence":0.93,"host":"career.example.eu"}',
  '      log 22:07:03.197Z [review] fill: marks: 9 starred, 8 required {"board":"x"}',
  '      log 22:07:03.203Z [extension] fill: fields: 8 filled, 3 left {"fields":[]}',
  '      field filled text "E-Mail-Adresse" required=true reason=your details', `      field left text "Passwort" required=true reason=${NO_ANSWER}`];

test('a run that ends on the account page is "account-first: held": the sign-up page\'s fields are not the application\'s', () => {
  const result = parseLive(SIGN_UP.join('\n'));
  assert.equal(result.reached, 'account');
  assert.equal(result.note, 'account-first: held');
  assert.deepEqual([result.filled, result.left, result.marks, result.fieldList], [null, null, null, []]);
  assert.equal(shortfall(result), null);
  assert.deepEqual(verdictFields(result), {});
  assert.deepEqual(compare({a: {reached: 'form', filled: 8, url: 'u'}}, {a: {...result, url: 'u'}}), [], 'the sign-up count it had last time is no regression to fall from');
});

test('past the account page the application form counts again, and no hold is noted', () => {
  const result = parseLive([...SIGN_UP, '      log 22:08:00.000Z [extension] fill: page kind: form {"by":"ai","host":"career.example.eu"}',
    '      log 22:08:05.000Z [extension] fill: fields: 5 filled, 1 left {"fields":[]}', '      field filled text "Vorname" required=true reason=your details'].join('\n'));
  assert.deepEqual([result.reached, result.filled, result.left, result.fieldList.length, result.note], ['form', 5, 1, 1, undefined]);
  // A page that is a sign-up and the form at once (the AI's "account-form") is the application: its fields count.
  const both = parseLive(SIGN_UP.join('\n').replace('page kind: account', 'page kind: account-form'));
  assert.deepEqual([both.reached, both.filled, both.note], ['form', 8, undefined]);
  // The Apply press drew a form on the posting that only led to the sign-up page: still held at the account step.
  const routed = parseLive([...SIGN_UP.slice(0, 2), '      log 16:35:44.777Z [extension] fill: after the press: a form came {"host":"jobs.example.com"}', ...SIGN_UP.slice(2, 4)].join('\n'));
  assert.deepEqual([routed.reached, routed.note], ['account', 'account-first: held']);
  // An eligibility stop keeps its own note.
  assert.match(parseLive([...SIGN_UP.slice(0, 3), '      log 15:38:32.019Z [extension] fill: did not fill: The role is in Sydney. {"url":"x"}'].join('\n')).note, /^eligibility stop: /);
});

// A stop the ladder already named (owner/cc, 11 Oct 2026, Louis Vuitton, H&M, Cloudera: "No cause recorded"): the numbered digest's own outcome is the cause. A site that
// refuses the visitor or a sign-in wall is a documented hold, never a fix; neither is a clean run (only account-first is).
const DIGEST = outcome => ['  live +  0s: Apply pressed on https://jobs.example.com/job/1/',
  '      log 10:00:00.000Z [extension] page kind: other {"shape":"jobs.example.com/job/*|0","by":"ai","rung":2}',
  '      log 10:00:01.000Z [extension] page kind: posting {"shape":"jobs.example.com/job/*|0","by":"digest","rung":3}',
  `      log 10:00:01.100Z [extension] digest: outcome=${outcome} verb=none numbers=[] press_kind=- dropped=-`];

test('the digest outcome refused is the hold "site refused: retry later"; login_wall is "login wall: held"; both leave the step at the posting', () => {
  for (const [outcome, note] of [['refused', SITE_REFUSED], ['login_wall', LOGIN_WALL]]) {
    const result = parseLive(DIGEST(outcome).join('\n'));
    assert.deepEqual([result.reached, result.note], ['posting', note], outcome);
  }
  assert.equal(parseLive(DIGEST('other').join('\n')).note, undefined, 'an outcome that names no stop is no hold');
  assert.equal(parseLive(DIGEST('expired').join('\n')).note, undefined);
});

test('a form reached after the refusal clears the hold (the block came and went); an account-first hold keeps its own note', () => {
  const later = parseLive([...DIGEST('refused'), '      log 10:01:00.000Z [extension] fill: fields: 5 filled, 1 left {"fields":[]}'].join('\n'));
  assert.deepEqual([later.reached, later.note], ['form', undefined]);
  assert.equal(parseLive([...SIGN_UP, '      log 22:07:04.000Z [extension] digest: outcome=login_wall verb=none numbers=[] press_kind=- dropped=-'].join('\n')).note, 'account-first: held');
});

// A posting that says how to apply without a form (11 Oct 2026, the small French employer: "the posting asks for the application by email: reported to the app"): the app tells the person,
// so the run ended where it should. The extension's own fixed lines name it (never the page's words); like the other holds it is no clean run, and a form reached later clears it.
const TOLD = line => ['  live +  0s: Apply pressed on https://jobs.example.com/job/1/',
  '      log 10:00:00.000Z [extension] page kind: posting {"shape":"jobs.example.com/job/*|0","by":"ai","rung":2}', `      log 10:00:01.000Z [extension] fill: ${line} {"host":"jobs.example.com"}`];

test('a posting that asks for the application by email, or tells what to do, is a documented hold at the posting', () => {
  assert.deepEqual([parseLive(TOLD('the posting asks for the application by email: reported to the app').join('\n'))].map(r => [r.reached, r.note]), [['posting', APPLY_BY_EMAIL]]);
  assert.deepEqual([parseLive(TOLD('the page tells what to do: reported to the app').join('\n'))].map(r => [r.reached, r.note]), [['posting', PAGE_TELLS]]);
  assert.equal(parseLive(TOLD('the ladder ended at the person: reported as other').join('\n')).note, undefined, 'the ladder giving up is a stop to fix, not a hold');
  assert.equal(parseLive([...TOLD('the posting asks for the application by email: reported to the app'), '      log 10:01:00.000Z [extension] fill: fields: 5 filled, 1 left {"fields":[]}'].join('\n')).note, undefined, 'a form reached later clears it');
});

// 11 Oct 2026 (Louis Vuitton jobs): a run ended "5 of 8 filled" with a site dialog over the form and no warning. The extension's line now says so; it is a needs-fix reason, never ready.
test('a dialog left open over the form: not ready, an error with the reason', () => {
  const out = parseLive('Apply pressed on u\n[extension] page kind: form {}\n[extension] fill: fields: 9 filled, 0 left\n[extension] fill: a dialog was left open over the form {"host":"h","buttons":3}');
  assert.equal(out.reached, 'form');
  assert.ok(out.errors.some(line => /dialog was left open over the form/.test(line)));
  assert.equal(parseLive('Apply pressed on u\n[extension] page kind: form {}\n[extension] fill: fields: 9 filled, 0 left').reached, 'ready');
});

// The form judge found the page blocked after the fill (11 Oct 2026, Louis Vuitton: "5 of 8 required filled" read as a success with a dialog over the form): its own reason, never a silent success.
test('a run whose last form judgment is blocked has an error naming the kind; one that was blocked and then ready does not', () => {
  const run = last => `Apply pressed on u\n[extension] page kind: form {}\n[extension] fill: fields: 5 filled, 3 left\n[extension] panel: application form ready?: blocked {"host":"x.example","blocked":"dialog"}\n${last}`;
  const blocked = parseLive(run(''));
  assert.deepEqual([blocked.blocked, blocked.errors], ['dialog', ['form judge: the page is blocked after the fill (dialog)']]);
  const freed = parseLive(run('[extension] panel: application form ready?: needs_person {"host":"x.example"}'));
  assert.deepEqual([freed.blocked, freed.errors], [undefined, []]);
});

// Owner, 11 Oct 2026: the screenshot where the extension stopped is a must; a run that ends without one is an error with its reason, a run with one is not.
test('a run that printed "no end screenshot: <why>" has an error naming why; "end screenshot kept" has none', () => {
  const base = 'Apply pressed on u\n[extension] page kind: form {}\n[extension] fill: fields: 9 filled, 0 left\n';
  assert.deepEqual(parseLive(`${base}  live: no end screenshot: no page tab was open`).errors, ['no end screenshot: no page tab was open']);
  assert.deepEqual(parseLive(`${base}  live: end screenshot kept`).errors, []);
});

test('a fill held by a dialog nothing closes: a needs-fix reason, never ready', () => {
  const out = parseLive('Apply pressed on u\n[extension] page kind: form {}\n[extension] fill: held: a dialog covers the form {"host":"h","text":"robot check","buttons":1}');
  assert.ok(out.errors.some(line => /held: a dialog covers the form/.test(line)));
  assert.notEqual(out.reached, 'ready');
});
