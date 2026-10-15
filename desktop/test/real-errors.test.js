// Real fill errors reach Sentry and the owner's Telegram once (lib/real-errors.js): a fake error gives one scrubbed Sentry event and one notice per hour.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import * as sentry from '../lib/sentry.js';
import {classify, createWatcher} from '../lib/real-errors.js';

const DSN = 'https://abc123@o1.ingest.de.sentry.io/4500001';
const entry = (text, fields = {}, kind = 'fill') => ({at: '2026-10-15T20:00:00Z', kind, text, fields: {version: '0.9.12', ...fields}});
const failing = entry('the page fill failed', {error: "the fill failed on this page: Cannot read properties of null (reading 'trace') for ada@example.com", url: 'https://boards.example.com/jobs/12345/apply?name=Ada',
  at: 'at fill (chrome-extension://abcdef/page/fill.js:40:7) | at run (chrome-extension://abcdef/page/fill.js:90:3)'});

test('every error line is classified, and ordinary decisions are not', () => {
  for (const hit of [failing, entry('failed: boom'), entry('the Apply button could not be pressed', {error: 'x'}), entry('uncaught error', {error: 'x'}, 'error'),
    entry('dead end: tries', {error: 'TypeError: x'})]) assert.ok(classify(hit), hit.text);
  for (const miss of [entry('dead end: tries'), entry('a dropdown step was slow', {ms: 3000}), entry('opened the tab', {}, 'tabs')]) assert.equal(classify(miss), null, miss.text);
});

test('a fake fill error gives one Sentry event with no personal data and one notice per hour', () => {
  const sent = [], notices = [];
  let clock = 1_000_000;
  const client = sentry.create({dsn: DSN, release: 'job-pilotto@0.9.12', installId: 'inst-1', fetcher: (url, init) => { sent.push(JSON.parse(init.body.split('\n')[2])); return Promise.resolve({}); }, now: () => clock});
  const watch = createWatcher({sentry: client.capture, notice: text => notices.push(text), now: () => clock});
  watch([failing]);
  watch([failing]);   // the same error again at once: no second notice, no second event
  assert.equal(sent.length, 1);
  assert.equal(notices.length, 1);
  const event = sent[0], text = JSON.stringify(event) + notices[0];
  assert.equal(event.tags.kind, 'fill_error');
  assert.equal(event.tags.host, 'boards.example.com');
  assert.equal(event.tags.extVersion, '0.9.12');
  assert.ok(event.exception.values[0].stacktrace.frames.length === 2, 'the stack goes with it');
  assert.doesNotMatch(text, /ada@example\.com|12345|name=Ada|Ada/, 'no email, no job id, no query');
  clock += 3600_001;   // an hour later: told again
  watch([failing]);
  assert.equal(notices.length, 2);
  assert.match(notices[0], /fill error on boards\.example\.com \(extension 0\.9\.12\): .*reading 'trace'/);
});

test('the extension turns an uncaught error into a decision line this watcher reads', () => {
  const log = fs.readFileSync(new URL('../../extension/log.js', import.meta.url), 'utf8');
  assert.match(log, /addEventListener\('error'/);
  assert.match(log, /addEventListener\('unhandledrejection'/);
});
