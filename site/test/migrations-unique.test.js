// No two D1 migrations may share a number: D1 tracks them by file name, so a clash applies both but hides the mistake (16 Oct 2026: 0083_hosted.sql and 0083_mail.sql were both written for 0083).
// The pairs below already exist and are applied in production (renaming one would apply it again); the test fails for any new clash and names the next free number.
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {test} from 'node:test';

const ALLOWED = new Set(['0003_contributions.sql', '0003_feedback.sql', '0032_download_net.sql', '0032_pool_indexes.sql', '0046_form_answers.sql', '0046_proposal_use.sql',
  '0071_fill_cards_gaps.sql', '0071_form_reports.sql', '0083_hosted.sql', '0083_mail.sql',
  '0093_changelog.sql', '0093_intel_facts.sql']);   // already applied: never rename (0093: #1368 and #1373 each passed alone, both deployed 18 Oct 2026)

test('each migration number is used by one file (the pairs already applied are the only exceptions)', () => {
  const files = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  const byNumber = new Map();
  for (const name of files) byNumber.set(name.slice(0, 4), [...(byNumber.get(name.slice(0, 4)) || []), name]);
  const next = String(Math.max(...[...byNumber.keys()].map(Number)) + 1).padStart(4, '0');
  for (const [number, names] of byNumber) {
    if (names.length > 1 && !names.every(name => ALLOWED.has(name))) assert.fail(`migration number ${number} is used by ${names.join(' and ')}: rename the new one to the next free number, ${next}`);
  }
  assert.ok(files.length > 0);
});
