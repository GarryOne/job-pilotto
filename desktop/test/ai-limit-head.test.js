// A run the AI provider stopped (usage limit, rate limit) says so in plain words with the one fix, not "Had problems"
// and a raw log (the owner's mockup, 6 Oct 2026). One variant of the failure box, beside the others.
import assert from 'node:assert/strict';
import test from 'node:test';
import {aiLimitHead, failureHead} from '../renderer/run-status.js';

const limited = {ok: false, kind: 'mail', billing: 'Anthropic API credits',
  log: ['Gmail: reading new emails…', "anthropic.BadRequestError: Error code: 400 - {'type': 'error', 'error': {'message': 'You have reached your specified API usage limits.'}}"]};

test('a Gmail check stopped by the usage limit: what happened, what it means, and the way to raise the limit', () => {
  assert.deepEqual(aiLimitHead(limited, 'Gmail check'), {
    problem: limited.log[1], title: 'Gmail check couldn’t finish',
    summary: 'The AI provider’s usage limit was reached. Email processing could not complete.',
    hint: 'Increase your limit, then run the check again.',
    fix: {label: 'Manage AI limit', url: 'https://console.anthropic.com/settings/limits'}});
});

test('on the Claude subscription the button opens its usage page; a rate limit asks to wait, with no button', () => {
  assert.equal(aiLimitHead({...limited, billing: 'Claude subscription'}, 'Gmail check').fix.url, 'https://claude.ai/settings/usage');
  const busy = aiLimitHead({ok: false, kind: 'search', log: ['anthropic.RateLimitError: Error code: 429']}, 'Jobs check');
  assert.equal(busy.summary, 'The AI provider’s rate limit was hit. Scoring could not complete.');
  assert.equal(busy.fix, null);
});

test('other failures and successful runs keep their own box', () => {
  assert.equal(aiLimitHead({ok: false, kind: 'mail', log: ['Google sign-in expired']}, 'Gmail check'), null);
  assert.equal(aiLimitHead({...limited, ok: true}, 'Gmail check'), null);
  assert.equal(failureHead({ok: false, problem: 'Google sign-in expired'}).fix.label, 'Reconnect Google');
});
