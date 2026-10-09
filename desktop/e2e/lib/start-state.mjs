// "This suite starts with no X": the start state of a suite, on any store (P7 step 4). On Notion (the real test page, which keeps every run's rows, and the stand-in)
// the rows are moved to the trash as before (lib/notion.mjs emptyDatabase). On this Mac's store every run starts from a fresh profile, so there is nothing left from
// an earlier run to clear, and the store interface keeps run history (no delete): what the store holds is read through ctx.data and said. Guarded by test/start-state.test.mjs.
import {emptyDatabase} from './notion.mjs';

// A Notion database (by the title the suites use, or part of it) -> the store's entity.
export const ENTITY_OF = [['Job Matches', 'matches'], ['Cronjob Runs', 'cron_runs'], ['Job Tracker', 'applications'], ['Interviews', 'interviews'],
  ['Employers', 'employers'], ['Application Events', 'events'], ['Insights', 'insights'], ['Agent Runs', 'agent_runs']];
export const entityOf = title => ENTITY_OF.find(([part]) => String(title).includes(part))?.[1] || null;

// -> how many rows were cleared (0 on this Mac's store, where a fresh profile has no earlier run's rows).
export async function clearData(ctx, title) {
  if (ctx.store !== 'sqlite') return emptyDatabase(ctx.token, title);
  const entity = entityOf(title);
  if (!entity) throw new Error(`no store entity for the Notion database "${title}" (lib/start-state.mjs ENTITY_OF)`);
  const rows = await ctx.data(entity, 'list', {});
  if (rows?.length) console.log(`  this Mac's store holds ${rows.length} ${entity} row(s) at the start (a fresh profile: the app's own start-up)`);
  return 0;
}
