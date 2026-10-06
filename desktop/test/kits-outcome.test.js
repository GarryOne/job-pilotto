// A Tailor CVs run where some failed: how many of how many from the message's subtitle, and the failed jobs from the run's own log
// lines (desktop/main.js "  ✗ <title> · <company>: <reason>"); nothing guessed when those lines are missing (owner, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitsOutcome, parseKitsReady} from '../renderer/kits-ready.js';

const message = ['✂️ Tailored CVs ready', '3 of 5 tailored · 2 failed · check each before you apply', '',
  'Site Reliability Engineer (https://jobs.example/1)', 'DeepJudge AG', '', 'Production Engineer (https://jobs.example/2)', 'DeepJudge AG', '',
  'Senior SRE (https://jobs.example/3)', 'Alpaca'].join('\n');

test('done of total from the subtitle; the failed jobs from the log', () => {
  const kits = parseKitsReady(message);
  const outcome = kitsOutcome(kits, ['Tailoring 4 of 5: Staff Platform Engineer · Nango', '  ✗ Staff Platform Engineer · Nango: the AI answer could not be read', '  ✓ Senior SRE · Alpaca']);
  assert.deepEqual([outcome.done, outcome.total], [3, 5]);
  assert.deepEqual(outcome.failed, [{title: 'Staff Platform Engineer', company: 'Nango', reason: 'the AI answer could not be read'}]);
});

test('without failure lines nothing is named; a full run is n of n', () => {
  assert.deepEqual(kitsOutcome(parseKitsReady(message), []).failed, []);
  const full = kitsOutcome(parseKitsReady(message.replace('3 of 5 tailored · 2 failed', '3 of 3 tailored')), []);
  assert.deepEqual([full.done, full.total], [3, 3]);
});
