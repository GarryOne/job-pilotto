// A run the AI provider stopped (usage limit, rate limit) says so in plain words with the one fix, not "Had problems"
// and a raw log (the owner's mockup, 6 Oct 2026). One variant of the failure box, beside the others.
import assert from 'node:assert/strict';
import test from 'node:test';
import {aiLimitHead, failureHead} from '../renderer/run-status.js';

const limited = {ok: false, kind: 'mail', billing: 'Anthropic API credits',
  log: ['Gmail: reading new emails…', "anthropic.BadRequestError: Error code: 400 - {'type': 'error', 'error': {'message': 'You have reached your specified API usage limits.'}}"]};

test('an API spend limit the user set: its words and the limits page', () => {
  assert.deepEqual(aiLimitHead(limited, 'Gmail check'), {
    problem: limited.log[1], title: 'Gmail check couldn’t finish',
    summary: 'Your API spend limit was reached. Email processing could not complete.',
    hint: 'Raise the limit, then run it again.',
    fix: {label: 'Manage API limits', url: 'https://console.anthropic.com/settings/limits'}});
});

test('each limit its own words and page: credits, a plan (with its reset time only when said), a rate limit, the unknown', () => {
  const credits = aiLimitHead({ok: false, kind: 'search', log: ['anthropic.BadRequestError: Your credit balance is too low to access the Anthropic API.']}, 'Jobs check');
  assert.equal(credits.summary, 'API credits are exhausted. Scoring could not complete.');
  assert.deepEqual(credits.fix, {label: 'Manage API billing', url: 'https://console.anthropic.com/settings/billing'});
  const plan = aiLimitHead({ok: false, kind: 'mail', billing: 'Claude subscription', log: ['Claude Code: You have reached your usage limit for this period. Your limit will reset at 3pm.']}, 'Gmail check');
  assert.equal(plan.summary, 'Your plan’s usage limit was reached. Email processing could not complete.');
  assert.equal(plan.hint, 'It resets at 3pm; run it again then.');
  assert.deepEqual(plan.fix, {label: 'View plan usage', url: 'https://claude.ai/settings/usage'});
  assert.equal(aiLimitHead({ok: false, kind: 'mail', billing: 'Claude subscription', log: ['usage limit reached']}, 'Gmail check').hint, 'Run it again once your plan’s usage resets.');
  const busy = aiLimitHead({ok: false, kind: 'search', log: ['anthropic.RateLimitError: Error code: 429']}, 'Jobs check');
  assert.equal(busy.summary, 'Too many requests to the AI provider. Scoring could not complete.');
  assert.equal(busy.fix, null);
  assert.equal(aiLimitHead({ok: false, kind: 'search', log: ['AI limit reached']}, 'Jobs check').fix.label, 'Manage AI limit');
});

test('other failures and successful runs keep their own box', () => {
  assert.equal(aiLimitHead({ok: false, kind: 'mail', log: ['Google sign-in expired']}, 'Gmail check'), null);
  assert.equal(aiLimitHead({...limited, ok: true}, 'Gmail check'), null);
  assert.equal(failureHead({ok: false, problem: 'Google sign-in expired'}).fix.label, 'Reconnect Google');
});
