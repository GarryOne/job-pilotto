/* global document */
// Launch the real Job Pilotto app (Electron) with a throwaway profile, like a first-time user, and drive it through Playwright.
// Nothing here touches the real user's data: JOB_PILOTTO_USER_DATA points at a fresh temp folder and no .env is read.
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DESKTOP = path.resolve(E2E, '..');
export const ARTIFACTS = process.env.E2E_ARTIFACTS || path.join(E2E, 'artifacts');

// -> {app, page, profile, shot(name), close()}. `env` adds to the app's environment (models, test hooks).
export async function launch({env = {}, executablePath, args} = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-'));
  fs.mkdirSync(ARTIFACTS, {recursive: true});
  // The test app is a stranger to the product: no technical reports, no employer-pool sharing, nothing it learns leaves this computer.
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({telemetry: false, shareEmployers: false}));
  const app = await electron.launch({
    executablePath: executablePath || path.join(DESKTOP, 'node_modules', '.bin', 'electron'),
    args: args || [DESKTOP, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {...process.env, JOB_PILOTTO_USER_DATA: profile, JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_E2E: '1', ...env},
    timeout: 90000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  page.on('pageerror', error => console.log(`  ! page error: ${error.message}`));
  await confirmQuiet(profile);
  const shot = name => page.screenshot({path: path.join(ARTIFACTS, `${name}.png`)}).catch(() => {});
  return {app, page, profile, shot, close: () => closeApp(app)};
}

// Which wizard step is showing.
export const step = page => page.evaluate(() => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step ?? null);

// Stand in for the native file dialog (Playwright cannot click an OS window): the next showOpenDialog returns this file.
export const pickFile = (app, file) => app.evaluate(({dialog}, filePath) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});
}, file);

// The app has its own quit handling (it asks before closing while sessions run), so app.close() can wait forever. Exit it directly,
// and kill the process if even that does not return.
async function closeApp(app) {
  try {
    const child = app.process();
    await Promise.race([app.evaluate(({app: electron}) => electron.exit(0)).catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  } catch { /* the app is already gone */ }
}

// Wait until the visible page has stopped loading (no skeleton bars or spinners), up to `seconds`; returns whether it settled. A screenshot taken
// while a page still shows its loading state makes the AI review report skeletons as bugs, and a slow CI machine shows them for longer.
export async function settle(page, seconds = 20) {
  try {
    await page.waitForFunction(() => ![...document.querySelectorAll('.view:not([hidden]) .skeleton, .view:not([hidden]) .spinner')].some(el => el.offsetParent !== null),
      null, {timeout: seconds * 1000});
    await page.waitForTimeout(400);
    return true;
  } catch { return false; }
}

// The journey must never alter the live telemetry (the owner's rule, 2 Oct 2026). The app says in its own log why it is not reporting; no such line, no run.
async function confirmQuiet(profile) {
  const log = path.join(profile, 'logs', 'app.log');
  for (let waited = 0; waited < 20000; waited += 500) {
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    if (/\[telemetry\] reporting is off: the end-to-end journey/.test(text)) return;
    if (/\[telemetry\] reporting follows/.test(text)) throw new Error('the app would report to the live product: refusing to run the journey');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('the app did not confirm that reporting is off: refusing to run the journey');
}

// After a run: nothing may be waiting to be sent.
export function assertNothingQueued(profile) {
  for (const name of ['telemetry-queue.json', 'analytics-queue.json']) {
    const file = path.join(profile, name);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').replace(/\s/g, '').length > 2) throw new Error(`${name} has events waiting to be sent`);
  }
}
