// The Connect Notion prompt stays out of a connect that someone else started (wizard e2e, 3 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {UNDERWAY_MS, closeOnProgress, connectUnderway, ignoreGateEvent} from '../renderer/notion-connect-rules.js';

test('a connect is underway for five minutes after its last news, then it is over', () => {
  const now = 1_000_000_000;
  assert.equal(connectUnderway(0, now), false, 'no news: nothing underway');
  assert.equal(connectUnderway(now - 1000, now), true);
  assert.equal(connectUnderway(now - UNDERWAY_MS - 1, now), false);
});

test('a "needs Notion" event during a running connect is not asked again', () => {
  const now = 5_000_000;
  assert.equal(ignoreGateEvent({since: now - 2000, now}), true);
  assert.equal(ignoreGateEvent({since: 0, now}), false, 'no connect running: the prompt opens as before');
});

test('news from a connect the prompt did not start closes a prompt left open; its own connect keeps it', () => {
  assert.equal(closeOnProgress({dialogOpen: true, ownConnect: false}), true);
  assert.equal(closeOnProgress({dialogOpen: true, ownConnect: true}), false);
  assert.equal(closeOnProgress({dialogOpen: false, ownConnect: false}), false);
});

test('the prompt\'s page uses the rules for both the gate event and the progress news', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/notion-connect.js', import.meta.url), 'utf8');
  assert.match(source, /ignoreGateEvent\(\{since: underwaySince\}\)/);
  assert.match(source, /closeOnProgress\(\{dialogOpen: dialog\.open, ownConnect: own\}\)/);
  assert.match(source, /box\.connecting = true/);
});
