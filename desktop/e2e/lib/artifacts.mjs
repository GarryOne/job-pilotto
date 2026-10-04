// What a suite leaves behind for the UI loop (ui-findings.yml), written even when the suite stops at a failing step: its layout findings so far, and which steps failed.
import fs from 'node:fs';
import path from 'node:path';

// The layout findings collected so far (a suite that stops early used to leave none, hiding that night's findings).
export function writeFindings(ctx) {
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'ui-findings.json'), JSON.stringify(ctx.findings || [], null, 2));
}

// The steps that failed, as records the loop files as issues (message cut to a readable length).
export const failureRecords = (suite, results) => results.filter(result => result.status === 'failed')
  .map(result => ({suite, step: result.name, message: String(result.note || '').slice(0, 600), ...(result.environment ? {environment: true} : {})}));

// suite-failures.json, every run: the failed steps, or an empty list.
export function writeSuiteFailures(dir, suite, results) {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'suite-failures.json'), JSON.stringify(failureRecords(suite, results), null, 2));
}
