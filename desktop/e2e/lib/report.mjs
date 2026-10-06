// Runs one suite inside Playwright's test runner, for the Playwright HTML report (report/playwright.config.mjs, report/suite.spec.mjs), and returns the exit code
// the suite itself decided (written by the spec to a file): a skipped suite, a failed one and a crash keep their meaning for run-all.mjs and the workflows.
// Where the report goes: a local run, artifacts/<suite>/report/index.html (`npx playwright show-report artifacts/<suite>/report`); CI, a blob that the
// workflow's report job merges into one report for the run (E2E_BLOB_DIR).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {E2E} from './app.mjs';

export const CONFIG = path.join(E2E, 'report', 'playwright.config.mjs');

// What the spec wrote, else the runner's own exit code (a crash before the suite decided), never a silent 0.
export function codeFrom(file, exitCode) {
  try { const text = fs.readFileSync(file, 'utf8').trim(); if (/^\d+$/.test(text)) return Number(text); } catch { /* the spec never got that far */ }
  return exitCode || 1;
}

export async function runInReport(name, env = process.env) {
  const {SUITES} = await import('./context.mjs');
  if (!SUITES.includes(name)) { console.error(`usage: node suite.mjs ${SUITES.join('|')}`); return 2; }
  const codeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-code-')), 'code');
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  // The blob (CI) goes to a folder of its own, then joins E2E_BLOB_DIR: the blob reporter empties its folder first, which would drop an earlier suite's blob
  // in the same job (6 Oct 2026: the Windows apply suite runs twice, Chromium then Edge).
  const blobTmp = path.join(path.dirname(codeFile), 'blob');
  const child = spawn(process.execPath, [cli, 'test', '--config', CONFIG], {cwd: E2E, stdio: 'inherit', env: {...env, E2E_SUITE: name, E2E_IN_REPORT: '1', E2E_CODE_FILE: codeFile, E2E_BLOB_TMP: blobTmp}});
  process.on('exit', () => { if (child.exitCode === null) child.kill('SIGKILL'); });   // suite.mjs's hard stop must not leave the runner behind
  const exitCode = await new Promise(done => child.on('close', code => done(code)));
  try {
    const into = env.E2E_BLOB_DIR || path.join(E2E, 'blob-report');
    for (const file of fs.existsSync(blobTmp) ? fs.readdirSync(blobTmp).filter(item => item.endsWith('.zip')) : []) { fs.mkdirSync(into, {recursive: true}); fs.copyFileSync(path.join(blobTmp, file), path.join(into, file)); }
  } catch (error) { console.log(`  (the report blob was not kept: ${error.message})`); }
  return codeFrom(codeFile, exitCode);
}
