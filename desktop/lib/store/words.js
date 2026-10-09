// What desktop/lib says to the person (errors, toasts, dialogs, results) names Notion only while Notion holds the data: the main
// process's twin of renderer/store-words.js, read from the settings (lib/notion-gate.js onNotion). A sentence that reads the same on
// every store needs neither. Guarded by test/store-words.test.js (desktop/lib is counted too).
import * as notionGate from '../notion-gate.js';

export const byStore = (storage, notion, mac) => (notionGate.onNotion(storage) ? notion : mac);
