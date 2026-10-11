// Which applicant the e2e apps hold, as a short hash (no text): desktop/demo/draft.json, seeded by the Electron run (lib/seed.mjs fastSeed) and the plain-node app
// (lib/offline-app-child.mjs, since 9f6ff67). Every capture records it (lib/replay-candidate.mjs saveCandidate, lib/live-row.mjs); a row replay (row.mjs) names a
// capture made with another seed or none: its fill asks carry another profile, so they miss the row's kept answers. Guard: test/applicant-seed.test.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo', 'draft.json');
export const OLD_SEED = 'captured with an older applicant seed: fill asks will miss; re-capture the row live (npm run smoke -- --only "<row>") before trusting its fill';

// The parts of the applicant an AI ask carries (the Profile, the standard answers, the search and its preferences, the imported CV). -> 12 hex characters
export function seedVersion(file = SEED_FILE) {
  const {draft} = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cvJson = fs.readFileSync(new URL('../fixtures/cv.json', import.meta.url), 'utf8');   // the CV's jobs and schools ride in every fill ask (<cv_facts>)
  return crypto.createHash('sha256').update(JSON.stringify([draft.profile_markdown, draft.answers_markdown, draft.search, draft.preferences, cvJson])).digest('hex').slice(0, 12);
}

// -> '' when the capture in caseDir was made with this seed, else OLD_SEED (a capture from before the seed was recorded has none).
export function seedNote(caseDir, current = seedVersion()) {
  let item = null;
  try { item = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf8')); } catch { /* no case: the replay says so itself */ }
  return item && item.seed !== current ? OLD_SEED : '';
}
