// The memory of the form trace (spec docs/superpowers/specs/2026-10-16-report-from-the-trace.md §3): per tab, the pages of an application as groups of net-record entries, capped by size,
// entries and age, the first pages pinned, a sign-in page dropped whole and marked as a gap. Pure: no Chrome, no clock but `now`; trace.js feeds it. Never written anywhere.
// Guard: desktop/test/trace-buffer.test.js.
export const LIMITS = {maxTab: 30e6, maxAll: 60e6, maxEntries: 4000, maxAgeMs: 3 * 3600e3, pinned: 3};

export function createBuffer({limits = {}, now = Date.now} = {}) {
  const cap = {...LIMITS, ...limits};
  const tabs = new Map();   // tab id -> {parts: [page | {gap: true}], truncated}
  const tab = id => { if (!tabs.has(id)) tabs.set(id, {parts: [], truncated: false}); return tabs.get(id); };
  const pagesOf = id => tab(id).parts.filter(part => !part.gap);
  const bytesOf = id => pagesOf(id).reduce((sum, page) => sum + page.bytes, 0);
  const totalBytes = () => [...tabs.keys()].reduce((sum, id) => sum + bytesOf(id), 0);
  const countOf = id => pagesOf(id).reduce((sum, page) => sum + page.entries.length, 0);

  // The oldest page of a tab that is not pinned and not the one now shown, once the caps are over (or it is older than the time cap).
  const victimIn = (id, over) => {
    const pages = pagesOf(id);
    return pages.find((page, index) => index >= cap.pinned && index < pages.length - 1 && (over || now() - page.startedAt > cap.maxAgeMs)) || null;
  };
  const drop = (id, victim) => { const state = tab(id); state.parts.splice(state.parts.indexOf(victim), 1); state.truncated = true; };
  // Drops pages until the caps hold: this tab's own caps first, then the total (other tabs' oldest pages go before this tab's). -> whether the caps hold
  function evict(id) {
    for (;;) {
      const ownOver = bytesOf(id) > cap.maxTab || countOf(id) > cap.maxEntries, allOver = totalBytes() > cap.maxAll;
      let victim = victimIn(id, false), from = id;
      if (!victim && allOver) for (const other of tabs.keys()) if (other !== id && (victim = victimIn(other, true))) { from = other; break; }
      if (!victim && (ownOver || allOver)) { victim = victimIn(id, true); from = id; }
      if (!victim) return !(ownOver || allOver);
      drop(from, victim);
    }
  }

  return {
    // A new page of the application (a top-level navigation).
    page(id) { const page = {startedAt: now(), entries: [], bytes: 0, document: false}; tab(id).parts.push(page); return page; },
    current: id => tab(id).parts.filter(part => !part.gap).at(-1) || null,
    // One finished request of the page now shown. A body that would not fit is kept out (the entry stays).
    add(id, entry, bytes = 0) {
      const state = tab(id);
      let page = state.parts.at(-1);
      if (!page || page.gap) { page = {startedAt: now(), entries: [], bytes: 0, document: false}; state.parts.push(page); }
      if (bytes && bytesOf(id) + bytes > cap.maxTab * 1.2) { entry = {...entry, body: null, size: 0}; bytes = 0; state.truncated = true; }
      page.entries.push(entry); page.bytes += bytes;
      if (entry.type === 'document') page.document = true;
      evict(id);
    },
    // A sign-in page was found: that page (the one now shown, `from`) and every page after it (a navigation that began since) are dropped whole, and the gap is marked once.
    dropFrom(id, from) {
      const state = tab(id), found = from ? state.parts.indexOf(from) : -1, at = found >= 0 ? found : state.parts.length - 1;   // a page already evicted: the last one goes
      if (at >= 0) state.parts.splice(at);
      if (state.parts.at(-1) && !state.parts.at(-1).gap) state.parts.push({gap: true});
    },
    has: id => pagesOf(id).some(page => page.entries.length),
    pageCount: id => pagesOf(id).filter(page => page.entries.length).length,
    bytes: bytesOf,
    // -> {entries, truncated}: scope 'journey' = every page, each entry numbered by its segment (`seg`, a gap starts the next); 'page' = the page now shown only.
    snapshot(id, scope = 'journey') {
      const state = tab(id), entries = [];
      let seg = 0;
      const parts = scope === 'page' ? state.parts.slice(-1).filter(part => !part.gap) : state.parts;
      for (const part of parts) {
        if (part.gap) { seg += 1; continue; }
        for (const entry of part.entries) entries.push({...entry, seg});
      }
      return {entries: entries.sort((a, b) => a.seg - b.seg || a.startMs - b.startMs), truncated: state.truncated};
    },
    drop(id) { tabs.delete(id); },
    dropAll() { tabs.clear(); },
    ids: () => [...tabs.keys()],
  };
}
