// The last good result of a slow screen read (Jobs, Focus, Strategy), kept on this Mac: the screen shows it at
// once while a fresh read from Notion runs, then swaps in the fresh one (stale-while-revalidate). A cache in the
// data rules' sense: rebuilt by the next read, never edited, never the only copy. Tied to the Notion workspace, so
// switching workspaces never shows another workspace's jobs.
export const NAMES = ['jobs', 'focus', 'strategy'];
const file = name => `cache/${name}.json`;
const workspace = storage => storage.settings().notionIds?.NOTION_APPLICATIONS_DB || '';

// Keep a fresh result (not an error, not a list read from the cache because Notion was unreachable); returns it.
export function remember(storage, name, result) {
  if (NAMES.includes(name) && result && result.ok !== false && !result.error && !result.stale) {
    storage.writeText(file(name), JSON.stringify({at: new Date().toISOString(), workspace: workspace(storage), result}));
  }
  return result;
}
// {at, result} of the last good read of this workspace, or null.
export function recall(storage, name) {
  if (!NAMES.includes(name)) return null;
  try {
    const saved = JSON.parse(storage.readText(file(name)));
    return saved.workspace === workspace(storage) ? {at: saved.at, result: saved.result} : null;
  } catch { return null; }
}
