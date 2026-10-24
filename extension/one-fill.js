// One fill per tab AND page at a time: a second ask for the page a fill is already on joins that fill; an ask for another page of the tab (the form after a sign-up) is its own fill (Windows beta, 17 Oct 2026, run 39060910058: the sign-up page's fill was still running when the tab moved to the form; the form's fill ended first, then the sign-up fill's card-id write wiped its "done"). A reload (or any new document load) in the tab retires its entry: the fill running belongs to the destroyed document, so the reloaded page's ask must start its own, never join it (beta 12, 24 Oct 2026: the apply suite's reused Lever tab stayed unfilled ~90 s). Guard: worker/test/one-fill.test.js.
const running = new Map();   // tabId -> {page, fill}: the fill running on it
const pageOf = url => String(url || '').split('#')[0];

// A fill's card id goes onto the page it filled, never onto the one the tab shows now.
export const stillOnPage = (fillUrl, nowUrl) => !nowUrl || pageOf(fillUrl) === pageOf(nowUrl);

// The tab's address now ('' when it cannot be read: nothing to protect).
export const addressNow = async tabId => { try { return (await chrome.tabs.get(tabId))?.url || ''; } catch { return ''; } };

export function oneFillPerTab(tabId, url, start, {onJoin = () => {}} = {}) {
  const page = pageOf(url), live = running.get(tabId);
  if (live && live.page === page) { onJoin(); return live.fill; }
  const entry = {page, fill: Promise.resolve().then(start).finally(() => { if (running.get(tabId) === entry) running.delete(tabId); })};
  running.set(tabId, entry);
  return entry.fill;
}

// The tab loaded a new document (reload, F5, a committed navigation): the running fill belongs to the old one, so the next ask starts its own.
export const retireFill = tabId => { running.delete(tabId); };
