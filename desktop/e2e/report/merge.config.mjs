// The config for merging every suite's blob into one HTML report (the workflows' report jobs: `playwright merge-reports -c report/merge.config.mjs`).
// Suites run on Mac and Linux runners, so the blobs name two test folders (/Users/runner/… and /home/runner/…) and Playwright refuses to merge them
// without a testDir of its own (7 Oct 2026: "Blob reports being merged were recorded with different test directories").
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export default {testDir: path.dirname(fileURLToPath(import.meta.url))};
