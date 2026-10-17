// Which of a job list's rows have a tailored CV and a cover-letter PDF on this Mac: the two flags "finished" (lib/ready.js complete) and "Tailor CVs for top matches" read.
// Set where the list is read (pipeline.jobs), so every caller sees the same rows (17 Oct 2026: only the Jobs page set `tailored` and nothing set `letter`, so Send tonight could never find a finished job). Guard: test/job-flags.test.js.
import * as cvlib from './cv.js';
import * as jobLetter from './job-letter.js';

export function markFinished(storage, result) {
  for (const job of result?.jobs || []) {
    job.tailored = !!job.code && cvlib.exists(storage, job.code);
    job.letter = !!job.code && jobLetter.hasPdf(storage, job.code);
  }
  return result;
}
