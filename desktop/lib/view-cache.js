// The last good result of a slow screen read (Jobs, Focus, Strategy), kept on this Mac: the screen shows it at
// once while a fresh read from Notion runs, then swaps in the fresh one (stale-while-revalidate). A cache in the
// data rules' sense: rebuilt by the next read, never edited, never the only copy. Tied to the Notion workspace, so
// switching workspaces never shows another workspace's jobs.
export const NAMES = ['jobs', 'focus', 'strategy', 'contact', 'knowledge'];
// contact, knowledge: what a form fill needs from Notion (your details, learned answers), so a fill never waits on
// Notion nor fails when it's busy (lib/server.js me(): answered from here, refreshed in the background).
// Not "cache/": on a Mac that's Chromium's own Cache folder (case-insensitive), which Electron may clear.
const file = name => `view-cache/${name}.json`;
const workspace = storage => storage.settings().notionIds?.NOTION_APPLICATIONS_DB || '';

// Keep a fresh result (not an error, not a list read from the cache because Notion was unreachable); returns it.
export function remember(storage, name, result) {
  if (NAMES.includes(name) && result && result.ok !== false && !result.error && !result.stale) {
    storage.writeText(file(name), JSON.stringify({at: new Date().toISOString(), workspace: workspace(storage), result}));
  }
  return result;
}
// On (owner, 28 Sep 2026, after the reads were made parallel): a screen shows its last result at once, says how old
// it is ("Saved 3 min ago · updating…") and swaps in the fresh read. "viewCache": false in settings.json turns it off.
export const enabled = storage => storage.settings().viewCache !== false;

// {at, result} of the last good read of this workspace, or null (also when the view cache is off).
export function recall(storage, name) {
  if (!NAMES.includes(name) || !enabled(storage)) return null;
  try {
    const saved = JSON.parse(storage.readText(file(name)));
    return saved.workspace === workspace(storage) ? {at: saved.at, result: saved.result} : null;
  } catch { return null; }
}
