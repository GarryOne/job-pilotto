// What the run list shares between main.js's activity() and the start-up background jobs (lib/background-handlers.js): the run history last read from
// Notion, and the cloud runs asked for that have not shown up there yet. One object, so both sides reassign the same binding (8 Oct 2026, the main.js split).
export const runState = {notionRuns: null, pendingCloud: []};
