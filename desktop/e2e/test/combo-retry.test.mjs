// A menu the fill gave up on is tried once more when the page is quiet, never more than once (extension/combo-retry.js; 14 Oct 2026, a loaded machine: the AI pick ate the menu's budget).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clickWithRetry} from '../../../extension/combo-retry.js';

// A fake fill: `outcomes[label]` is the list of results per attempt ('gaveup' or 'picked'); a given-up menu is skipped until forgotten, as flow.js does.
function fake(outcomes, starvedLabels = Object.keys(outcomes)) {
  const given = new Set(), tries = {}, retried = new Set();
  const pass = async () => {
    const results = [];
    for (const label of Object.keys(outcomes)) {
      if (given.has(label)) continue;
      const attempt = tries[label] = (tries[label] || 0) + 1;
      if (outcomes[label][attempt - 1] === 'picked') results.push({label, picked: true});
      else if (outcomes[label][attempt - 1] === 'gaveup') { given.add(label); results.push({label, picked: false}); }
    }
    return results;
  };
  let quiets = 0;
  const run = () => clickWithRetry({pass, gaveUp: () => [...given], starved: label => starvedLabels.includes(label), forget: labels => labels.forEach(l => given.delete(l)), quiet: async () => { quiets++; }, retried});
  return {run, tries, get quiets() { return quiets; }};
}

test('a menu given up on is retried once, the page quiet first, and its pick replaces the give-up', async () => {
  const f = fake({'Are you Hispanic/Latino?': ['gaveup', 'picked'], Country: ['picked']});
  const results = await f.run();
  assert.equal(f.tries['Are you Hispanic/Latino?'], 2);
  assert.equal(f.quiets, 1);
  assert.deepEqual(results.map(r => [r.label, r.picked]).sort(), [['Are you Hispanic/Latino?', true], ['Country', true]]);
});

test('a menu that is given up on twice is not tried a third time, in this pass or a later one', async () => {
  const f = fake({Dead: ['gaveup', 'gaveup', 'picked']});
  await f.run();
  await f.run();
  assert.equal(f.tries.Dead, 2);
});

test('a fill with no give-up is one pass and never waits for quiet', async () => {
  const f = fake({A: ['picked'], B: ['picked']});
  await f.run();
  assert.equal(f.quiets, 0);
  assert.equal(f.tries.A, 1);
});

test('a menu given up on while the page was quiet (a list that never opens) is not waited on twice', async () => {
  const f = fake({Address: ['gaveup', 'picked']}, []);
  await f.run();
  assert.equal(f.tries.Address, 1);
  assert.equal(f.quiets, 0);
});
