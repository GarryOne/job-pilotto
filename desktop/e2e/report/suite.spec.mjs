// The one test of a suite's Playwright run (lib/report.mjs): the suite's own run (lib/suite-main.mjs) with each step as a Playwright step, so the HTML report
// shows the steps, a screenshot after each, the failure, the trace and the logs. The exit code the suite decided goes to E2E_CODE_FILE for suite.mjs.
import fs from 'node:fs';
import {test} from '@playwright/test';

const name = process.env.E2E_SUITE;
const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux';

test(name, {tag: [`@${platform}`, ...(process.env.E2E_BROWSER ? [`@${process.env.E2E_BROWSER}`] : [])]}, async ({}, testInfo) => {   // eslint-disable-line no-empty-pattern
  const {runSuite} = await import('../lib/suite-main.mjs');
  const result = await runSuite(name, {
    step: (title, body) => test.step(title, body),
    skipStep: title => test.step.skip(title, async () => {}),
    attach: (title, options) => testInfo.attach(title, options),
  });
  if (process.env.E2E_CODE_FILE) fs.writeFileSync(process.env.E2E_CODE_FILE, String(result.code));
  test.skip(!!result.skipped, result.skipped);
  // The report's error box: each failed step and why, in words (the steps below show where, with the screenshot and the trace).
  if (result.code) {
    const error = new Error(result.failed?.length ? `${result.failed.length} step(s) failed\n${result.failed.join('\n')}` : `the ${name} suite stopped: ${result.stopped || 'see stdout'}`);
    error.stack = error.message;   // our wrapper's code frame says nothing about the app
    throw error;
  }
});
