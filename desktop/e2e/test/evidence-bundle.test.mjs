// The evidence bundle of a smoke run (lib/evidence-bundle.mjs): one folder per shape and day holding what a fixer needs to name the blocker without a re-run
// (job-pilotto-cc's post-mortem, 11 Oct 2026: ~40% of every fix was a wrong first guess), and a run that did not finish records and uploads nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {evidenceLines, runFinished, writeBundle} from '../lib/evidence-bundle.mjs';

const LOG = `2026-10-10T23:22:02.048Z [extension] page kind: posting {"shape":"jobs.hornbach.com/austria/job/*/*|1-2","by":"ai","rung":2,"confidence":0.85,"usd":0,"applyBy":"form","frames":0}
2026-10-10T23:22:02.212Z [extension] fill: page kind: posting {"by":"ai","confidence":0.85,"host":"jobs.hornbach.com","ms":4461,"version":"0.9.184"}
2026-10-10T23:22:02.436Z [extension] fill: pressed the Apply button {"host":"jobs.hornbach.com","label":"Jetzt bewerben (ohne Anmeldung)","tag":"a","version":"0.9.184"}
2026-10-10T23:22:21.465Z [extension] fill: after the press: no form came {"host":"jobs.hornbach.com","openMs":-1,"opens":0,"tabs":1}
2026-10-10T23:22:41.105Z [extension] page kind: posting {"shape":"jobs.hornbach.com/austria/job/*/*|1-2","by":"digest","rung":3,"confidence":0.8,"frames":0,"digest":true}
2026-10-10T23:22:41.110Z [extension] digest: outcome=apply verb=press numbers=[4] press_kind=button dropped=-
2026-10-10T23:22:43.640Z [extension] fill: pressed the control the digest named {"host":"jobs.hornbach.com","label":"Jetzt bewerben (mit Anmeldung)"}
2026-10-10T23:22:51.296Z [extension] page kind: account {"shape":"career5.successfactors.eu/careers|p1-2","by":"ai","rung":2,"confidence":0.93}
2026-10-10T23:22:52.000Z [run] start: python -m src.desktop visit-list {"run_id":"x"}
2026-10-10T23:22:53.000Z [extension] fill: no form on this page {"role":"no-form"}
2026-10-10T23:22:59.000Z [extension] fill: filled the form {"ineligible":false,"aiEligible":false,"forced":"kit","url":"https://x"}`;

test('the four lines that matter: what was asked, the digest answer, what was pressed, where the page went', () => {
  const lines = evidenceLines(LOG);
  assert.deepEqual(Object.keys(lines), ['pageKind', 'digest', 'pressed', 'wentTo', 'verdict']);
  assert.match(lines.verdict[0], /filled the form .*"aiEligible":false,"forced":"kit"/, 'the AI\'s own verdict and what passed it');
  assert.equal(lines.pageKind.length, 3);   // the three decisions, with frames and the digest flag in them
  assert.match(lines.pageKind[1], /by":"digest".*"digest":true/);
  assert.match(lines.digest[0], /digest: outcome=apply verb=press numbers=\[4\]/);
  assert.deepEqual(lines.pressed.map(line => /pressed the Apply button|after the press|pressed the control the digest named/.exec(line)?.[0]),
    ['pressed the Apply button', 'after the press', 'pressed the control the digest named']);
  assert.ok(lines.wentTo.some(line => /page kind: account/.test(line)) && lines.wentTo.some(line => /no form on this page/.test(line)));
  assert.ok(!JSON.stringify(lines).includes('visit-list'), 'an unrelated line');
  assert.ok(Object.values(lines).flat().every(line => line.length <= 320 && !/^\d{4}-/.test(line)), 'a line is cut and shown from its time');
});

test('no log, no lines: empty lists, never a throw', () => {
  assert.deepEqual(evidenceLines(''), {pageKind: [], digest: [], pressed: [], wentTo: [], verdict: []});
  assert.deepEqual(evidenceLines(undefined), {pageKind: [], digest: [], pressed: [], wentTo: [], verdict: []});
});

test('a run that was killed or cut short did not finish: it records and uploads nothing', () => {
  const done = '  live 01:22: watched 90s; frames in 3\n  live: removed 0 job row(s) of the live posting\n';
  assert.equal(runFinished({output: `x\n${done}`, signal: null}), true);
  assert.equal(runFinished({output: `x\n${done}`, signal: 'SIGTERM'}), false);   // killed after it printed
  assert.equal(runFinished({output: 'live 01:22: page kind: posting\n', signal: null}), false);   // cut short: no end of watching (eb's 23 s row)
  assert.equal(runFinished({output: '', signal: null}), false);
});

test('the bundle: one folder per day and shape with the evidence file, the run log, the app log and the AI calls; a missing part is skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bundle-'));
  const folder = writeBundle({dir, day: '2026-10-11', shape: 'Hornbach SuccessFactors', output: 'run output', appLog: LOG, aiCalls: '[]', result: {reached: 'form', filled: 8, left: 3}});
  assert.equal(folder, path.join(dir, '2026-10-11', 'hornbach-successfactors'));
  assert.deepEqual(fs.readdirSync(folder).sort(), ['ai-calls.json', 'app.log', 'evidence.md', 'run.log']);
  const text = fs.readFileSync(path.join(folder, 'evidence.md'), 'utf8');
  assert.match(text, /Hornbach SuccessFactors/);
  assert.match(text, /reached form, 8 filled, 3 left/);
  for (const part of ['page kind', 'digest', 'pressed', 'where the page went']) assert.match(text.toLowerCase(), new RegExp(part));
  assert.match(text, /after the press: no form came/);
  const lean = writeBundle({dir, day: '2026-10-11', shape: 'No logs', output: 'run output', appLog: '', aiCalls: '', result: {reached: 'posting'}});
  assert.deepEqual(fs.readdirSync(lean).sort(), ['evidence.md', 'run.log']);
});

test('smoke.mjs: an unfinished run is dropped before anything is recorded or uploaded; a finished one writes its bundle', () => {
  const source = fs.readFileSync(new URL('../smoke.mjs', import.meta.url), 'utf8');
  const check = source.indexOf('runFinished('), record = source.indexOf('results[shape] = {url: posting.url, ...parseLive'), bundle = source.indexOf('writeBundle(');
  assert.ok(check > 0 && record > check, 'runFinished must be checked before the result is recorded');
  assert.ok(bundle > record, 'the bundle is written from a finished run');
  assert.match(source, /signal/, 'liveRun passes the exit signal on');
});

// 11 Oct 2026: a fixer and the owner see the final state of the application tab without a live run. One picture a run, kept next to the bundle's other files, never uploaded.
test('the run\'s end-of-run screenshot (LIVE_CAPTURE_DIR/end.png) is kept in the bundle as end.png; with none, nothing is made up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bundle-')), capture = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cap-'));
  fs.writeFileSync(path.join(capture, 'end.png'), 'png bytes');
  const withShot = writeBundle({dir, day: '2026-10-11', shape: 'With picture', output: 'o', appLog: LOG, result: {reached: 'form'}, captureDir: capture});
  assert.ok(fs.readdirSync(withShot).includes('end.png'));
  assert.match(fs.readFileSync(path.join(withShot, 'evidence.md'), 'utf8'), /end\.png/);
  const without = writeBundle({dir, day: '2026-10-11', shape: 'No picture', output: 'o', appLog: LOG, result: {reached: 'form'}, captureDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cap-'))});
  assert.ok(!fs.readdirSync(without).includes('end.png'));
});

test('both live paths take the end-of-run picture before their last privacy check, so a tripwire hit deletes it with the rest', () => {
  for (const [file, final] of [['../lib/apply-live.mjs', 'if (trip || (trip = await tripped()))'], ['../lib/live-row.mjs', 'if (tripped || (tripped = await trip()))']]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8'), shot = source.indexOf('takeEndShot('), last = source.indexOf(final);
    assert.ok(shot > 0 && last > shot, `${file}: the end picture is taken before the final tripwire check`);
  }
});

test('takeEndShot photographs the last http tab into end.png, and does nothing without one', async () => {
  const {takeEndShot} = await import('../lib/end-shot.mjs');
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shot-')), 'cap');
  const tab = url => ({url: () => url, screenshot: async ({path: file}) => fs.writeFileSync(file, 'png')});
  assert.equal(await takeEndShot({pages: () => [tab('chrome-extension://x/options'), tab('https://a.example/apply')]}, dir), path.join(dir, 'end.png'));
  assert.ok(fs.existsSync(path.join(dir, 'end.png')));
  assert.equal(await takeEndShot({pages: () => [tab('chrome-extension://x/options')]}, path.join(dir, 'none')), '');
});
