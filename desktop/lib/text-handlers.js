// Settings → Profile's texts (the Profile, standard answers, Form knowledge): read and edited block by block on every store, through
// lib/text-outline-handlers.js (IPC textOutline / textEdit). The whole-page read and write of 9 Oct 2026 (textGet / textSave) went with the
// textarea (owner, 16 Oct 2026: "I don't want to see plain textarea anymore"). Guarded by test/text-outline.test.js.
import * as store from './store/index.js';
import {registerTextOutlineHandlers} from './text-outline-handlers.js';

export function registerTextHandlers({ipcMain, storage, DEMO, log, open = store.openStore}) {
  registerTextOutlineHandlers({ipcMain, storage, DEMO, log, open});
}
