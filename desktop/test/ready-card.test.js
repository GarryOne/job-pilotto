// The Ready to send card on Actions (renderer/pages/ready-card.js) is always shown: before the server answers, and whenever it cannot work it says why
// with its two buttons off (owner, 18 Oct 2026: "show the card always, no matter what... an error message/status and disabled buttons").
import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from './tiny-dom.js';

install();   // components.js builds elements as it loads; shared.js reads the app state once
globalThis.window.pilot = {state: async () => ({})};
const {initReadyCard} = await import('../renderer/pages/ready-card.js');
const {OUTDATED_LINE} = await import('../renderer/errors.js');

const page = () => {
  const body = install(), pair = globalThis.document.createElement('div'), tailor = globalThis.document.createElement('button');
  pair.className = 'task-pair'; tailor.id = 'tailor-top'; pair.append(tailor); body.append(pair);
  return body;
};
const buttons = card => card.querySelectorAll('.task-body button');
const textOf = node => node.textContent;
const nameOf = node => node.getAttribute('aria-label') || node.textContent;   // a row's icon button is read by its name

test('every way the card cannot work: it is shown, says why, and its buttons are off', async () => {
  const cases = [
    ['not the owner, with a reason', async () => ({owner: false, why: 'Our site gave this install no token today (its daily limit); asked again at 02:00.'}), /no token today/],
    ['not the owner, no reason', async () => ({owner: false}), /did not answer/],
    ['no answer at all', async () => null, /did not answer/],
    ['the call threw', async () => { throw new Error('the app is restarting'); }, /restarting/],
  ];
  for (const [name, readyState, says] of cases) {
    const body = page();
    globalThis.window.pilot = {readyState, readyTonight: async () => ({ok: false})};
    await initReadyCard();
    const card = body.querySelector('.ready-card');
    assert.ok(card, `${name}: the card is shown`);
    assert.match(textOf(card), says, name);
    assert.ok(textOf(card).includes('Not available'), name);
    assert.ok(buttons(card).length >= 2 && buttons(card).every(button => button.disabled), `${name}: Fill tonight and Fill now are off`);
    assert.ok(card.querySelector('.ready-status button'), `${name}: Try again`);
  }
});

test('the card shows at once, before the server answers, with its buttons off', async () => {
  const body = page();
  let answer;
  globalThis.window.pilot = {readyState: () => new Promise(resolve => { answer = resolve; }), readyTonight: async () => ({ok: false})};
  const done = initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.ok(card && /Checking our server/.test(textOf(card)));
  assert.ok(buttons(card).every(button => button.disabled));
  answer({owner: false, why: 'x'}); await done;
});

test('on the owner\'s install the buttons work, and tonight\'s count comes from a fresh job read', async () => {
  const body = page();
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: null, jobs: []}}),
    readyTonight: async () => ({ok: true, tonight: [{code: 'a'}, {code: 'b'}], names: {}})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.ok(buttons(card).every(button => !button.disabled));
  assert.match(textOf(card), /Tonight2 ready/, 'tonight as a badge (owner, 18 Oct 2026)');
  assert.ok(!textOf(card).includes('Not available'));
});

test('Try again answers visibly: Checking… while it asks, then the reason with the time it was checked (owner, 18 Oct 2026)', async () => {
  const body = page();
  let asked = 0, answer;
  globalThis.window.pilot = {readyState: () => { asked++; return asked === 1 ? Promise.resolve({owner: false, why: 'Not yet.'}) : new Promise(resolve => { answer = resolve; }); }, readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.match(textOf(card), /Not yet\. · checked \d\d:\d\d:\d\d/);
  const again = card.querySelector('.ready-status button');
  again.click();
  assert.equal(asked, 2, 'asked the server again');
  assert.equal(again.textContent, 'Checking…'); assert.equal(again.disabled, true);
  answer({owner: false, why: 'Still not.'}); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(textOf(body.querySelector('.ready-card')), /Still not\. · checked/);
});

test('what went to the server for tonight (by hand or by itself) is said on the card; nothing sent, no line', async () => {
  for (const [sent, says] of [[{count: 3, at: new Date(2026, 9, 18, 18, 40).toISOString()}, /Sent 3 · 18:40/], [null, null]]) {
    const body = page();
    globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: null, jobs: []}, sent}),
      readyTonight: async () => ({ok: false})};
    await initReadyCard();
    const text = textOf(body.querySelector('.ready-card'));
    if (says) assert.match(text, says); else assert.doesNotMatch(text, /Sent \d+ ·/);
  }
});

// The card follows a running night (live demo, 18 Oct 2026: after Fill now it re-read once at 30 s and the rows stayed "waiting" while the server had filled both forms;
// switching pages did not help). Each state a night can be in: re-read while it runs (or right after Fill now), stop when it ends, never re-read tonight's job list.
test('the card re-reads the night while the server fills it, and stops when it ends', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {FOLLOW_MS} = await import('../renderer/pages/ready-card.js');
  const cases = [
    ['running at open', ['running', 'running', 'finished'], false, 2],
    ['queued, then Fill now', ['queued', 'queued', 'running', 'finished'], true, 2],
    ['queued for tonight, no Fill now: no re-read', ['queued'], false, 0],
    ['finished at open: no re-read', ['finished'], false, 0],
    ['failed while running', ['running', 'failed'], false, 1],
  ];
  for (const [name, states, pressRun, rereads] of cases) {
    const body = page();
    let read = 0, tonight = 0;
    const night = () => states[Math.min(read, states.length - 1)];
    globalThis.window.pilot = {
      readyState: async () => { const state = night(); read++; return {owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {j: 'Job · Co'},
        site: {batch: {night: '2026-10-19', state}, jobs: [{job: 'j', state: state === 'finished' ? 'prepared' : 'queued'}]}}; },
      readyTonight: async () => { tonight++; return {ok: false}; }, readyRun: async () => ({ok: true})};
    await initReadyCard();
    const card = body.querySelector('.ready-card');
    if (pressRun) { card.querySelector('#ready-run').click(); await new Promise(resolve => setImmediate(resolve)); }
    const before = read, tonightBefore = tonight;
    for (let i = 0; i < 6; i++) { t.mock.timers.tick(FOLLOW_MS); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(read - before, rereads, `${name}: re-reads`);
    assert.equal(tonight, tonightBefore, `${name}: tonight's job list is not re-read while following`);
    if (states.at(-1) === 'finished' && rereads) assert.match(textOf(card), /complete/, `${name}: the row turns complete`);
  }
});

test('the card stops following once it is no longer on the page', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {FOLLOW_MS} = await import('../renderer/pages/ready-card.js');
  const body = page();
  let read = 0;
  globalThis.window.pilot = {readyState: async () => { read++; return {owner: true, settings: {}, tonight: [], names: {}, site: {batch: {state: 'running'}, jobs: []}}; }, readyTonight: async () => ({ok: false})};
  await initReadyCard();
  body.querySelector('.ready-card').remove();
  const before = read;
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(FOLLOW_MS); await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(read - before <= 1, 'at most the one read that finds it gone');
});

// The twin's driver refuses to press anything that reads like a Submit (e2e/lib/twin-guards.mjs), so no control on the card may read like one, or a live demo cannot
// press it (18 Oct 2026: "Open live" was refused for its tooltip "…press Submit yourself"). Every button of a card with each kind of row, text and tooltip.
test('no control on the card reads like a Submit to the twin\'s guard', async () => {
  const {looksLikeSubmit} = await import('../e2e/lib/twin-guards.mjs');
  const body = page();
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {},
    site: {batch: {night: '2026-10-19', state: 'finished'}, jobs: ['prepared', 'partial', 'wall', 'no-form', 'failed', 'queued'].map((state, i) => ({job: `j${i}`, state, video: true}))}}),
    readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const all = body.querySelector('.ready-card').querySelectorAll('button');
  assert.ok(all.length >= 24, 'Fill tonight, Fill now, Open in my browser ×3, Open live recording ×3, Watch the fill ×6, Fill again ×6, Done ×6');
  for (const button of all) assert.ok(!looksLikeSubmit(`${textOf(button)} ${button.title || ''} ${button.getAttribute('aria-label') || ''}`), `${textOf(button)} / ${button.title}`);
});

// Open in my browser (owner, 18 Oct 2026): every row with a filled form has it first, the picture stream ("Open live recording") beside it; a row
// with nothing to open has neither. Pressing it asks the app for that job and says what to do next.
test('each filled row offers Open in my browser first, then Open live recording', async () => {
  const body = page(), asked = [];
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {}, tonight: [], names: {},
    site: {batch: {night: '2026-10-19', state: 'finished'}, jobs: ['prepared', 'partial', 'wall', 'no-form', 'failed'].map((state, i) => ({job: `j${i}`, state}))}}),
    readyTonight: async () => ({ok: false}), readyOpen: async code => { asked.push(code); return {ok: true}; }};
  await initReadyCard();
  const card = body.querySelector('.ready-card'), rows = card.querySelectorAll('.ready-row');
  rows.forEach((row, i) => {
    const labels = row.querySelectorAll('button').map(nameOf);
    if (i < 3) assert.deepEqual(labels, ['Open in my browser', 'Open live recording', 'Fill again', 'Done'], `row ${i}`);
    else assert.deepEqual(labels, ['Fill again', 'Done'], `row ${i}: nothing to open`);
    if (i < 3) assert.equal(row.querySelector('.ready-open').querySelectorAll('button').length, 2, `row ${i}: the two ways to open it, one group`);
  });
  rows[1].querySelector('button').click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(asked, ['j1']);
  assert.match(textOf(card.querySelector('.ready-note')), /Opened in your browser/);
});

// An app older than its window ("No handler registered"): the card says to restart and offers Restart, never the raw IPC text.
test('an outdated app: the plain restart line and a Restart button on every way the card shows an error', async () => {
  const raw = new Error("Error invoking remote method 'readyOpen': Error: No handler registered for 'readyOpen'");
  const plain = new Error(OUTDATED_LINE);   // what the preload rejects with
  for (const [name, error] of [['preload text', plain], ['raw text', raw]]) {
    let relaunched = 0;
    const body = page();
    globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: null, jobs: []}}),
      readyTonight: async () => ({ok: false}), readySend: async () => { throw error; }, interviews: {relaunch: () => { relaunched++; }}};
    await initReadyCard();
    const card = body.querySelector('.ready-card');
    buttons(card)[0].click(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(textOf(card).includes(OUTDATED_LINE), `${name}: the plain line`);
    assert.ok(!/No handler registered|Error invoking/.test(textOf(card)), `${name}: never the raw text`);
    const restart = [...card.querySelectorAll('button')].find(button => button.textContent === 'Restart');
    assert.ok(restart, `${name}: a Restart button`);
    restart.click();
    assert.equal(relaunched, 1, `${name}: it restarts through the shared path`);
  }
});

// Watch the fill (owner, 18 Oct 2026): every row the night opened and kept a video for has it, also one it could not fill; it plays in a popup (owner, 18 Oct 2026: "not inline, but rather in a popup"),
// named for its form, and closing the popup lets the video's memory go.
test('a row with the night\'s video offers Watch the fill; it plays in a popup that closes', async () => {
  const body = page(), asked = [], revoked = [];
  const realRevoke = URL.revokeObjectURL; URL.revokeObjectURL = url => { revoked.push(url); };
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {}, tonight: [], names: {j1: 'SRE · Acme'},
    site: {batch: {night: '2026-10-19', state: 'finished'}, jobs: [{job: 'j0', state: 'prepared', video: true}, {job: 'j1', state: 'failed', video: true}, {job: 'j2', state: 'no-form', video: false}]}}),
    readyTonight: async () => ({ok: false}), readyVideo: async code => { asked.push(code); return {ok: true, bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])}; }};
  try {
    await initReadyCard();
    const card = body.querySelector('.ready-card'), rows = card.querySelectorAll('.ready-row');
    assert.deepEqual(rows.map(row => row.querySelectorAll('button').map(nameOf)), [['Open in my browser', 'Open live recording', 'Watch the fill', 'Fill again', 'Done'], ['Watch the fill', 'Fill again', 'Done'], ['Fill again', 'Done']]);
    const watch = rows[1].querySelectorAll('button')[0];
    watch.click(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(asked, ['j1']);
    assert.equal(card.querySelector('video'), null, 'nothing inline under the row');
    const popup = body.querySelector('#ready-video-dialog');
    assert.ok(popup, 'a popup');
    assert.equal(popup.tagName.toLowerCase(), 'dialog');
    assert.match(popup.className, /panel-dialog/, 'the app\'s dialog parts');
    assert.match(textOf(popup), /SRE · Acme/, 'named for its form');
    const src = popup.querySelector('video').src;
    assert.match(src, /^blob:/);
    assert.equal(nameOf(watch), 'Watch the fill', 'the row\'s button does not change');
    popup.querySelector('#ready-video-close').click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(body.querySelector('#ready-video-dialog'), null, 'closed');
    assert.deepEqual(revoked, [src], 'its memory let go');
    watch.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(body.querySelectorAll('#ready-video-dialog').length, 1, 'opens again, one at a time');
  } finally { URL.revokeObjectURL = realRevoke; }
});

// Fill now (owner, 18 Oct 2026: "I press Fill now and nothing really happens", "I'd expect it to start instantly", a progress bar, statuses as badges).
const owned = (site = {batch: null, jobs: []}, extra = {}) => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [{code: 'a'}], names: {a: 'SRE · Acme'}, site, ...extra});
const steps = card => card.querySelector('.ready-progress')?.querySelectorAll('.ui-pill').map(textOf).join(' | ') || '';

test('Fill now shows the bar at once, before any answer, and both buttons are off while it sends', async t => {
  t.mock.timers.enable({apis: ['setInterval']});   // the card's follow and clock timers
  const body = page();
  let answer;
  globalThis.window.pilot = {readyState: async () => owned(), readyTonight: async () => ({ok: false}), readyRun: () => new Promise(resolve => { answer = resolve; })};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  card.querySelector('#ready-run').click();
  assert.match(steps(card), /^Sending \d:\d\d \| Starting the server \| Filling \| Ready$/, 'instantly, no answer yet');
  assert.ok(card.querySelector('.ready-bar'), 'the bar');
  assert.ok(buttons(card).slice(0, 2).every(button => button.disabled));
  assert.equal(textOf(card.querySelector('#ready-run')), 'Filling…');
  answer({ok: true, queued: 1}); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(textOf(card.querySelector('.ready-note')), /Done.*1 job sent/);
  assert.ok(card.querySelector('.ready-note .ui-pill'), 'the line is a badge');
});

test('a running night: each form it works on shows its own bar and Stop, the card counts them, and neither send button can replace it', async t => {
  t.mock.timers.enable({apis: ['setInterval']});   // the card's follow and clock timers
  const body = page();
  globalThis.window.pilot = {readyState: async () => owned({batch: {night: '2026-10-18', state: 'running'}, jobs: [{job: 'a', state: 'prepared'}, {job: 'b', state: 'queued'}]}), readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const card = body.querySelector('.ready-card'), [done, line] = card.querySelectorAll('.ready-row');
  assert.equal(card.querySelector('.ready-progress'), null, 'no card-wide bar for a night this window did not start: the rows show it');
  assert.match(textOf(line.querySelector('.ready-row-live')), /Waiting its turn/);
  assert.ok(line.querySelector('.ready-stop'), 'its Stop');
  assert.match(textOf(done), /complete/);
  assert.match(textOf(card.querySelector('.ready-summary')), /1 waiting/);
  assert.ok(card.querySelector('.ready-stop-all'), 'and one Stop for the night');
  assert.ok(buttons(card).slice(0, 2).every(button => button.disabled), 'Fill tonight and Fill now are off');
  assert.match(textOf(card), /1 ready/);
});

test('Fill now asks first in a popup: Fill again fills the opened jobs, Cancel sends nothing', async t => {
  t.mock.timers.enable({apis: ['setInterval']});   // the card's follow and clock timers
  for (const yes of [true, false]) {
    const body = page(), calls = [];
    globalThis.window.pilot = {readyState: async () => owned(), readyTonight: async () => ({ok: false}),
      readyRun: async options => { calls.push(options); return options.confirmed ? {ok: true, queued: 1} : {ok: false, ask: {again: true, jobs: [{code: 'x', name: 'DevOps · Nordlicht'}], replaces: 1}}; }};
    await initReadyCard();
    const card = body.querySelector('.ready-card');
    card.querySelector('#ready-run').click(); await new Promise(resolve => setTimeout(resolve, 0));
    const popup = body.querySelector('#ready-confirm');
    assert.ok(popup, 'the popup');
    assert.match(textOf(popup), /Fill this job again\?.*DevOps · Nordlicht.*replaces 1 form/);
    popup.querySelector(yes ? '#ready-confirm-yes' : '#ready-confirm-no').click(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(body.querySelector('#ready-confirm'), null, 'closed');
    if (yes) assert.deepEqual(calls, [{}, {again: true, confirmed: true}]);
    else { assert.deepEqual(calls, [{}]); assert.match(textOf(card.querySelector('.ready-note')), /Not started/); assert.equal(card.querySelector('.ready-progress'), null, 'no bar left'); }
  }
});

test('nothing to fill: a Note badge with the reason, never "not on for this install", and the way to get a job ready', async t => {
  t.mock.timers.enable({apis: ['setInterval']});   // the card's follow and clock timers
  const body = page();
  globalThis.window.pilot = {readyState: async () => owned(undefined, {tonight: []}), readyTonight: async () => ({ok: false}),
    readyRun: async () => ({ok: false, nothing: true, error: 'Nothing to fill: no job has its kit, CV and cover letter yet. '})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.match(textOf(card), /Tonight0 ready/);
  assert.ok(!card.querySelectorAll('button').some(button => /Tailor CVs/.test(textOf(button))), 'no Tailor button: Fill now prepares the jobs (owner, 19 Oct 2026)');
  assert.match(textOf(card), /Fill now makes the kit, CV and letter/);
  card.querySelector('#ready-run').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(textOf(card.querySelector('.ready-note')), /^NoteNothing to fill/);
  assert.doesNotMatch(textOf(card), /not on for this install/);
  assert.equal(card.querySelector('.ready-progress'), null);
});

// The rows' buttons are icons (owner, 18 Oct 2026: "they're taking too much", "maybe we should use icons"): every one has its name (screen readers, tests) and a
// tooltip saying what it does, on every kind of row, so a new row button cannot land as a bare icon.
test('a row\'s main action shows its words; every other row button is an icon with its name and a tooltip', async () => {
  const body = page();
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {}, tonight: [], names: {},
    site: {batch: {night: '2026-10-19', state: 'finished'}, jobs: ['prepared', 'partial', 'wall', 'no-form', 'failed', 'queued'].map((state, i) => ({job: `j${i}`, state, video: true}))}}),
    readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const row = body.querySelector('.ready-card').querySelectorAll('.ready-row');
  const main = row.flatMap(each => each.querySelectorAll('.ready-browser'));
  assert.equal(main.length, 3, 'every row with a filled form has its main action');
  for (const button of main) assert.equal(button.querySelector('span').textContent, 'Open in Chrome', 'the main action has words (owner: "leave icons only for secondary buttons")');
  for (const button of row.flatMap(each => each.querySelectorAll('button'))) {
    if (!main.includes(button)) assert.match(button.className, /icon-btn/, nameOf(button));
    assert.ok(button.querySelector('svg'), `${nameOf(button)}: an icon`);
    assert.ok(button.getAttribute('aria-label'), 'a name');
    assert.ok(button.title.startsWith(`${button.getAttribute('aria-label')}: `), `${nameOf(button)}: a tooltip with its name`);
  }
});

// Fill again on a row (owner, 18 Oct 2026: "a button per row with fill again"): asks first, then fills that job only, sent and started like Fill now.
test('Fill again on a row: with no kit left on this Mac (the owner\'s night), it asks, then the server fills that form from the night; a refusal leaves the rows as they were', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  for (const answer of [{ok: true, batch: 'b1'}, {ok: false, error: 'This night reached its spending limit, so it is not filled again.'}]) {
    const body = page(), asked = [], ran = [];
    globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {}, tonight: [], names: {j0: 'SRE · Doctolib', j1: 'SRE Observability · Doctolib'},
      site: {batch: {night: '2026-10-18', state: 'finished'}, jobs: [{job: 'j0', state: 'prepared'}, {job: 'j1', state: 'prepared'}]}}),
      readyTonight: async () => ({ok: true, tonight: [], names: {}}),   // tonight: 0 ready, as on the owner's Mac
      readyRun: async options => { ran.push(options); return {ok: false}; }, readyAgain: async code => { asked.push(code); return answer; }};
    await initReadyCard();
    const card = body.querySelector('.ready-card'), rowsOf = () => card.querySelectorAll('.ready-row');
    const intact = when => rowsOf().forEach((row, i) => {
      assert.match(textOf(row.querySelector('.ui-pill')), /complete/, `${when}: row ${i} keeps its badge`);
      assert.ok(row.querySelector('.ready-browser') && row.querySelector('.ready-again'), `${when}: row ${i} keeps its buttons`);
    });
    rowsOf()[1].querySelector('.ready-again').click(); await new Promise(resolve => setImmediate(resolve));
    const popup = body.querySelector('#ready-confirm');
    assert.match(textOf(popup), /Fill this job again\?/);
    assert.match(textOf(popup), /SRE Observability · Doctolib/);
    assert.match(textOf(popup), /other forms keep what was filled/);
    popup.querySelector('#ready-confirm-yes').click(); await new Promise(resolve => setImmediate(resolve));
    intact('while it starts');
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(asked, ['j1'], 'the server fills that form, from the night');
    assert.deepEqual(ran, [], 'never looked up in this Mac\'s list');
    if (answer.ok) assert.match(textOf(card), /filling it again now/);
    else { assert.match(textOf(card.querySelector('.ready-note')), /spending limit/); assert.doesNotMatch(textOf(card), /not in your list/); intact('after a refusal'); }
  }
});

// One batch a night on the server: while a fill is sent or running, every button that sends one (Fill tonight, Fill now, each row's Fill again) is off, so a second
// press never replaces the fill running (18 Oct 2026: Fill again pressed on two rows wiped the first).
test('while a night is filled, Fill tonight and Fill now are off; a finished row\'s Fill again stays on (it joins the line)', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const body = page();
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {}, tonight: [], names: {},
    site: {batch: {night: '2026-10-19', state: 'running'}, jobs: [{job: 'j0', state: 'prepared'}, {job: 'j1', state: 'queued'}]}}),
    readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  for (const button of [card.querySelector('#ready-send'), card.querySelector('#ready-run')]) assert.equal(button.disabled, true, nameOf(button));
  const again = card.querySelectorAll('.ready-again');
  assert.equal(again.length, 1, 'the finished row has Fill again; the waiting row has Stop instead');
  assert.equal(again[0].disabled, false, 'it joins the running night');
  assert.equal(card.querySelector('.ready-browser').disabled, false, 'opening a filled form still works');
});

// Forms in a line (owner, 18 Oct 2026: "2 rows, 2 progress bars", "a line with live updates from each row", "a stop button once a row started"): each form the night
// works on has its own bar, live line and Stop; when one finishes, the other's bar goes on; Stop on a row stops that form, Stop all the night.
test('two forms in a line: two bars and live lines; one finishing leaves the other going; Stop stops one, Stop all the night', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {FOLLOW_MS} = await import('../renderer/pages/ready-card.js');
  const body = page(), stopped = [];
  const at = new Date(Date.now() - 65000).toISOString();
  let site = {batch: {night: '2026-10-18', state: 'running'}, jobs: [{job: 'j0', state: 'filling', step: 'answering', step_n: 2, started_at: at}, {job: 'j1', state: 'queued'}, {job: 'j2', state: 'prepared'}]};
  globalThis.window.pilot = {readyState: async () => owned(site), readyTonight: async () => ({ok: false}), readyStop: async code => { stopped.push(code); return {ok: true, stopped: 1}; }};
  await initReadyCard();
  const card = body.querySelector('.ready-card'), rows = () => card.querySelectorAll('.ready-row');
  const lineOf = i => rows()[i].querySelector('.ready-row-live');
  const width = i => lineOf(i)?.querySelector('.ready-bar i').style.width;
  assert.match(textOf(lineOf(0)), /Answering 2 questions with AI/);
  assert.match(textOf(lineOf(0)), /1:0\d/, 'its own clock');
  assert.match(textOf(lineOf(1)), /Waiting its turn/);
  assert.notEqual(width(0), width(1), 'two bars, each its own');
  assert.equal(lineOf(2), null, 'a finished form has no bar');
  assert.match(textOf(card.querySelector('.ready-summary')), /1 filling.*1 waiting/);

  site = {...site, jobs: [{job: 'j0', state: 'prepared'}, {job: 'j1', state: 'filling', step: 'opening', started_at: new Date().toISOString()}, {job: 'j2', state: 'prepared'}]};
  t.mock.timers.tick(FOLLOW_MS); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lineOf(0), null, 'j0 finished: its row shows its result');
  assert.match(textOf(rows()[0]), /complete/);
  assert.match(textOf(lineOf(1)), /Opening the job's page/, 'j1 goes on with its own line');

  rows()[1].querySelector('.ready-stop').click(); await new Promise(resolve => setImmediate(resolve));
  card.querySelector('.ready-stop-all').click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(stopped, ['j1', null], 'Stop on the row, then Stop all');
});

// Every long-running action on the card can be stopped: a form waiting or filling always has its Stop, and the night a Stop all, whatever its step.
test('every form the night works on has a Stop, at every step, and the night has Stop all', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const steps = [null, 'opening', 'form', 'filling', 'answering', 'reading'];
  const body = page();
  globalThis.window.pilot = {readyState: async () => owned({batch: {night: '2026-10-18', state: 'running'},
    jobs: steps.map((step, i) => (step ? {job: `j${i}`, state: 'filling', step, step_n: 1, started_at: new Date().toISOString()} : {job: `j${i}`, state: 'queued'}))}), readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  card.querySelectorAll('.ready-row').forEach((row, i) => {
    assert.ok(row.querySelector('.ready-stop'), `${steps[i] || 'waiting'}: a Stop`);
    assert.equal(row.querySelector('.ready-stop').textContent, 'Stop', 'with its word (icons alone are for secondary buttons only)');
    assert.ok(row.querySelector('.ready-row-live .ready-bar'), `${steps[i] || 'waiting'}: its bar`);
  });
  assert.ok(card.querySelector('.ready-stop-all'));
});
