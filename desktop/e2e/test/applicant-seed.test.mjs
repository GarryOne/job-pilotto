// Which applicant a capture was made with (lib/applicant-seed.mjs): every capture writer records it, and a row replay names a capture made with another one
// (its fill asks carry another profile, so they miss the kept answers: 9f6ff67, 11 Oct 2026, the plain-node app's 250-character profile became the full one).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {OLD_SEED, SEED_FILE, seedNote, seedVersion} from '../lib/applicant-seed.mjs';
import {saveCandidate} from '../lib/replay-candidate.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-seed-'));
const caseWith = item => { const dir = temp(); fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(item)); return dir; };

test('the seed version is a short hash of the applicant both e2e apps seed, and changes when that applicant does', () => {
  assert.match(seedVersion(), /^[0-9a-f]{12}$/);
  assert.equal(seedVersion(), seedVersion(), 'stable');
  const file = path.join(temp(), 'draft.json'), seeded = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(seeded));
  assert.equal(seedVersion(file), seedVersion());
  fs.writeFileSync(file, JSON.stringify({...seeded, draft: {...seeded.draft, profile_markdown: `${seeded.draft.profile_markdown}\nOne more line.`}}));
  assert.notEqual(seedVersion(file), seedVersion());
});

// Every place a capture's case.json is written (the smoke's candidate here; the plain-node live row in test/live-row.test.mjs) records the seed.
test('a capture records the seed it ran with; a replay names one recorded with another seed or none, and says what to do', () => {
  const folder = saveCandidate({dir: temp(), day: '2026-10-11', shape: 'Teamtailor form', result: {url: 'https://jobs.example.com/o/1', reached: 'posting'}, html: '<p>x</p>'});
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'case.json'), 'utf8')).seed, seedVersion());
  assert.equal(seedNote(folder), '', 'a capture of this seed replays without a word');
  for (const [name, item] of Object.entries({'no seed (before 9f6ff67)': {pages: []}, 'another seed': {pages: [], seed: '000000000000'}})) {
    assert.equal(seedNote(caseWith(item)), OLD_SEED, name);
  }
  assert.match(OLD_SEED, /older applicant seed: fill asks will miss; re-capture/);
});
