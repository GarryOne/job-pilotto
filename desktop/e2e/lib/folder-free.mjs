// Waits until a folder is no longer held by a process that outlived the app (Windows: a child's working directory or open handle keeps the folder, not its files, from being renamed
// or removed). The reset and the import of the next start need exactly that; a relaunch before it failed them (17 Oct 2026, Windows settings). Guarded by test/folder-free.test.mjs.
import fs from 'node:fs';

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// -> the milliseconds waited; throws after `timeout` with the last error, so a holder that never leaves is said, not hidden by a later vague failure.
export async function waitForFolderFree(dir, {timeout = 20000, every = 250, rename = fs.renameSync, exists = fs.existsSync} = {}) {
  const aside = `${dir}.probe`;
  let waited = 0;
  while (exists(dir)) {
    try { rename(dir, aside); rename(aside, dir); return waited; } catch (error) {
      if (!LOCKED.has(error.code)) throw error;
      if (waited >= timeout) throw new Error(`the data folder stayed held by a process after the app exited (${waited / 1000} s): ${error.message}`);
      await pause(every); waited += every;
    }
  }
  return waited;
}
