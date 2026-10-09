// What Settings → Your data says while the data moves to Notion and after (lib/store-move.js): pure, so its wording is tested
// (test/store-move-text.test.js); renderer/pages/data.js shows it.
// What each part of the data is called while it moves, and the texts Notion may already have.
export const MOVE_WORDS = {applications: 'applications', events: 'application history', matches: 'search results', interviews: 'interviews',
  insights: 'insights', employers: 'employers', agent_runs: 'form fills', cron_runs: 'run history', texts: 'your texts'};
// In a count: "40 runs", "3 history events".
const COUNT_WORDS = {...MOVE_WORDS, events: 'history events', cron_runs: 'runs', texts: 'texts'};
const TEXT_WORDS = {profile: 'a Profile', answers: 'standard answers', knowledge: 'form knowledge'};
// "Moved to Notion ✓ 12 applications, 40 runs." + one sentence per text Notion already had (the 3 Oct 2026 wording).
export function movedText({moved = {}, kept = [], archive = ''} = {}) {
  const parts = Object.entries(moved).filter(([, count]) => count).map(([entity, count]) => `${count} ${COUNT_WORDS[entity] || entity}`);
  const keptLines = kept.map(name => `Your Notion already had ${TEXT_WORDS[name] || name}, so it was kept; this Mac's version is in ${archive}.`);
  return [`Moved to Notion ✓${parts.length ? ` ${parts.join(', ')}.` : ''}`, ...keptLines].join(' ');
}
// Three states: trying (no home yet: keep it here, or connect Notion), this Mac (move it to Notion for Always on), Notion (open it there).
// The card asks capabilities (cloud, links), never a store's name.
