#!/usr/bin/env node
// Does this push need the e2e harness's own unit tests (`cd desktop/e2e && npm test`, what CI's e2e.yml "plan" job runs: about a minute)? Called by tools/pre-push-check.sh with the changed files on stdin; exit 0 = yes.
// They import the extension's page-file list and the ladder's modules (the 10 Oct 2026 move left 19 of them red, unseen by the hook). Guard: desktop/test/e2e-unit-wanted.test.js.
import {fileURLToPath} from 'node:url';

const WANTED = /^(desktop\/e2e\/|extension\/|desktop\/lib\/ladder\/|desktop\/lib\/(page-kind|account-judge|form-judge)\.js$)/;
export const wantsE2eUnit = changed => changed.some(file => WANTED.test(String(file).trim()));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => process.exit(wantsE2eUnit(input.split('\n').filter(Boolean)) ? 0 : 1));
}
