// One cause, two findings in one run (lib/same-cause.mjs): linked and labelled, never merged, and counted as a duplicate in the numbers (#275 and #277).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify} from '../lib/selfheal-stats.mjs';
import {sameCauseComment, sameCauseLinks} from '../lib/same-cause.mjs';

test('a failed step and a screenshot finding of the same suite and run are linked to the earlier one', () => {
  const created = [{number: 275, source: 'ai-review', suite: 'activityfailures', view: 'activity-notion-html'}, {number: 276, source: 'ai-review', suite: 'activityfailures', view: 'activity-notion-html'},
    {number: 277, source: 'suite-failure', suite: 'activityfailures', view: 'activityfailures'}];
  assert.deepEqual(sameCauseLinks(created), [{later: 277, earlier: 275}]);
});

test('different suites, or two suite failures, or no other finding: no link', () => {
  assert.deepEqual(sameCauseLinks([{number: 1, source: 'ai-review', suite: 'focus', view: 'focus'}, {number: 2, source: 'suite-failure', suite: 'calendar', view: 'calendar'}]), []);
  assert.deepEqual(sameCauseLinks([{number: 1, source: 'suite-failure', suite: 'focus', view: 'focus'}, {number: 2, source: 'suite-failure', suite: 'focus', view: 'focus'}]), []);
  assert.deepEqual(sameCauseLinks([{number: 2, source: 'suite-failure', suite: 'calendar', view: 'calendar'}]), []);
});

test('the comment names the other issue and the run, and the numbers count a possible duplicate as a duplicate unless a person confirmed it', () => {
  assert.match(sameCauseComment(275, 'https://x/runs/1'), /#275[^]*https:\/\/x\/runs\/1[^]*Not merged automatically/);
  const issue = labels => ({number: 277, state: 'OPEN', labels: labels.map(name => ({name})), comments: []});
  assert.equal(classify(issue(['auto-ui', 'possible-duplicate'])), 'duplicate');
  assert.equal(classify(issue(['auto-ui', 'possible-duplicate', 'confirmed'])), 'queued');
});
