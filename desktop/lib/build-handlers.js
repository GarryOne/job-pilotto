// Which build runs, over IPC (owner, 16 Oct 2026): the commit the window runs and, when the checkout has gained desktop/extension commits since the app started, "Restart to get N fixes".
// A package says its commit from build-info.json (scripts/stage.mjs); a source run from the checkout's HEAD at start. A package gets its fixes through the sidebar's Update button (lib/updater.js), so it is never "ahead" here.
// Guards: test/build-state.test.js (the numbers), test/build-handlers.test.js (the two handlers).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appBuild, headBuild, restartLabel} from './build-state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const packagedBuild = () => packagedInfo();
const packagedInfo = () => { try { const info = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'build-info.json'), 'utf8')); return {commit: String(info.commit || ''), time: String(info.at || info.date || '')}; } catch { return null; } };

export function registerBuildHandlers({app, ipcMain, FROM_SOURCE, repo, packaged = packagedInfo(), head = headBuild, count = appBuild}) {
  const running = packaged || head(repo);   // fixed at start: what is RUNNING, not what the checkout is now
  ipcMain.handle('buildState', () => {
    const state = count({repo, running}), ahead = FROM_SOURCE ? state.ahead : 0;
    return {...state, ahead, restart: ahead ? restartLabel(ahead) : '', fromSource: !!FROM_SOURCE};
  });
  // The app's own quit guard still asks when a job is running (before-quit); the relaunch happens after it.
  ipcMain.handle('restartApp', () => { app.relaunch(); app.quit(); return {ok: true}; });
}
