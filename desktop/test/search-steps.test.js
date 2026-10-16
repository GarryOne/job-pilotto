// "Find jobs" is one run: the first run lists jobs in seconds (the slice first), a later one searches as before, and the employer finder closes it when due.
import test from 'node:test';
import assert from 'node:assert/strict';
import {scoutDue, searchSteps} from '../lib/search-steps.js';

const storage = (settings = {}) => ({settings: () => ({aiEngine: 'cli', ...settings}), saveSettings: patch => Object.assign(settings, patch), secret: () => ''});
const commands = async (settings, trigger) => {
  const seen = [];
  await searchSteps(storage(settings), () => {}, 'run', trigger, async (_storage, args) => { seen.push(args.slice(0, 2).join(' ') + (args.includes('--first-jobs') ? ' --first-jobs' : '') + (args.includes('today') ? ' today' : '')); return {code: 0, result: {}}; });
  return seen;
};

test('the first run reads the slice and scores 3 jobs before the job boards, then grows the sources', async () => {
  const seen = await commands({lastScoutAt: undefined}, 'first');
  assert.equal(seen[0], 'src daily --first-jobs', 'the engine goes first: nothing stands in front of the first job');
  assert.ok(seen.findIndex(c => c.startsWith('src discover')) > 0);
  assert.equal(seen.at(-1), 'src scout');
});

test('a later press searches the job boards first, and runs the finder only when none ran today', async () => {
  const now = Date.now();
  const stale = await commands({lastScoutAt: new Date(now - 2 * 86400000).toISOString()}, 'you');
  assert.deepEqual(stale.slice(0, 2), ['src discover', 'src daily']);
  assert.equal(stale.at(-1), 'src scout');
  const fresh = await commands({lastScoutAt: new Date(now - 3600000).toISOString()}, 'you');
  assert.ok(!fresh.includes('src scout'));
});

test('a scheduled search and a search on GitHub leave the finder to their own schedule', () => {
  assert.equal(scoutDue({}, 'schedule'), false);
  assert.equal(scoutDue({cloud: {repo: 'x/y'}}, 'you'), false);
  assert.equal(scoutDue({}, 'first'), true);
});
