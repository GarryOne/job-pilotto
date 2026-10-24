// pages/office-progress.js: what the LibreOffice download shows at each step (the share, MB, time left, each step ticked off in order),
// Mac and Windows wording, and the failed / cancelled states with "Try again".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {officeView} from '../renderer/pages/office-progress.js';

const MB = 1048576, start = 1_000_000;
const kinds = view => view.steps.map(s => s.kind).join(' ');

test('nothing shown before a Word CV, nor once LibreOffice is ready', () => {
  assert.deepEqual(officeView({step: 'none'}), {hidden: true});
  assert.deepEqual(officeView({step: 'ready'}), {hidden: true});
});

test('downloading: share and MB on the right, time left from the speed so far, the steps after it still to come', () => {
  const view = officeView({step: 'download', bytes: 128 * MB, total: 305 * MB, started: start}, {now: start + 60_000});
  assert.equal(view.right, '41% · 128 of 305 MB');
  assert.ok(Math.abs(view.share - 128 / 305) < 1e-9);
  assert.match(view.steps[1].text, /128 of 305 MB, about 1 min left$/);
  assert.equal(kinds(view), 'done now next next next');
  assert.equal(view.action, 'Cancel');
});

test('each later step ticks the ones before it off; no MB once the download is done', () => {
  for (const [step, expected] of [['check', 'done done now next next'], ['unpack', 'done done done now next']]) {
    const view = officeView({step, started: start}, {now: start + 90_000});
    assert.equal(kinds(view), expected, step);
    assert.equal(view.share, 1);
    assert.equal(view.right, '');
  }
});

test('the size unknown: no share, the bar waits, MB so far only', () => {
  const view = officeView({step: 'download', bytes: 10 * MB, total: 0, started: start}, {now: start + 5000});
  assert.equal(view.share, null);
  assert.equal(view.right, '10 MB');
});

test('Mac and Windows: the unpack step names the person\'s own computer', () => {
  assert.match(officeView({step: 'unpack'}, {platform: 'darwin'}).steps[3].text, /on your Mac/);
  assert.match(officeView({step: 'unpack'}, {platform: 'win32'}).steps[3].text, /on your PC/);
});

test('failed or cancelled: says so, the CV still works, Try again', () => {
  const failed = officeView({step: 'failed', error: 'LibreOffice could not be downloaded (HTTP 503).'});
  assert.match(failed.fine, /HTTP 503.*still works/);
  assert.equal(failed.action, 'Try again');
  assert.deepEqual(failed.steps, []);
  assert.equal(officeView({step: 'cancelled'}).action, 'Try again');
});
