// State more than one page changes (an imported binding is read-only, so it lives on one object).
export const shared = {
  state: await window.pilot.state(),
  outdatedShown: false,
  openSessionId: null,
  xterm: null,
  xtermFit: null,
  dockOpen: false,  // "Application sessions" starts collapsed: the summary pills say what needs you, the head expands it
  termShownFor: null,
  draft: null,
  rebuildAsked: false,  // Rebuild from CV: the strategy step opens on the note + Build, not the last draft
  allJobs: [],
  logLines: [],  // the running task's lines, live
  idleSeen: true,  // nothing was running at the last check: the next log line starts a new task
  selectedRun: null,  // id of the past run picked in "Recent activity"; null = the latest
  awaitedRun: null,  // {kind, since}
  // Job pages open in Chrome now (reported by the extension; refreshed every 2 s), plus ones just opened here.
  openedInChrome: new Set(),
  formsOpen: null,  // {known, ids}: which sessions' forms are still open in Chrome (the extension's report)
};
