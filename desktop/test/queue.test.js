// A task started while another runs is listed as queued at once, and a second click on it doesn't queue it twice.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

test('tasks waiting behind the running one are listed, once each, in order', async () => {
  pipeline.serial(() => new Promise(() => {}));  // something long is running (never ends in this test)
  const storage = {settings: () => ({}), secret: () => '', path: name => `/tmp/${name}`, readText: () => '', writeText: () => {}};
  const insight = pipeline.task(storage, 'insight', ['src.daily'], () => {});
  const again = pipeline.task(storage, 'insight', ['src.daily'], () => {});
  pipeline.task(storage, 'weekly', ['src.daily'], () => {});
  assert.equal(again, insight);  // joined, not queued twice
  assert.deepEqual(pipeline.queued().map(item => [item.kind, item.trigger]), [['insight', 'you'], ['weekly', 'you']]);
  assert.ok(pipeline.queued().every(item => item.id && item.queuedAt));
});

test('Tidy duplicate events: the dialog\'s summary has no command-line hint (its button applies)', () => {
  const cli = 'Acme: Interview scheduled x2\n  KEEP  ev-1\n  extra ev-2\n1 duplicate event(s) would be moved to the Notion trash (run with --apply); 1 group(s).';
  assert.equal(pipeline.tidyText(cli).split('\n').pop(), '1 duplicate event(s) would be moved to the Notion trash; 1 group(s).');
  assert.equal(pipeline.tidyText('No duplicate events.'), 'No duplicate events.');
});
