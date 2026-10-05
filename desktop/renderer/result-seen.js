// Which finished runs have had their result card shown on Actions (#280, 5 Oct 2026). A run's id is its start time, so a search started at 10:00 that ends at 10:30 has a
// smaller id than an insight that started at 10:10 and was shown at 10:11: one high-water "seen" id forgot the search for good. Now `base` is the id at the first start
// (what was there already is not news; also what an older version stored as its high-water mark) and `shown` lists the ids shown since, so each run is judged by itself.
export const SHOWN_MAX = 200;

// The newest finished run of a kind that has a card, after `base`, not shown yet; `isCard(run)` says which runs qualify.
export const unseenRun = (runs, {base = 0, shown = []} = {}, isCard = () => true) =>
  runs.find(run => run.endedAt && !run.live && isCard(run) && run.id > base && !shown.includes(run.id)) || null;

export const withShown = (shown, id) => (shown.includes(id) ? shown : [...shown, id]).slice(-SHOWN_MAX);
