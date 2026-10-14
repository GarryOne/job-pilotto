// A suite too long for one CI job says `export const shards = n` (the recorded replay): every gate lane runs it as n jobs, `JP_REPLAY_SHARD=i/n` each (lib/replay-shard.mjs
// cuts the cases, as page-cases.yml does for the PR check). The matrix entries (plan-run.mjs, plan-windows.mjs) and the way back from a job's key to its suite live here.
// Guard: test/suite-shards.test.mjs (every slice fits its budget at today's case count; every workflow that runs a suite passes the shard and names its job by key).

export const shardKey = (suite, index, count) => `${suite}-${index}of${count}`;

// -> [{key, shard}]: one per slice, or the suite itself (shard '': the whole suite).
export const shardLegs = (suite, count = 1) => (count > 1
  ? Array.from({length: count}, (_, at) => ({key: shardKey(suite, at + 1, count), shard: `${at + 1}/${count}`}))
  : [{key: suite, shard: ''}]);

// A job's key (or job name) -> its suite: less the gate's store leg (-standin, plan-run.mjs) and the slice (-2of4).
export const suiteOfKey = key => String(key || '').replace(/-(standin|sqlite)$/, '').replace(/-\d+of\d+$/, '');

// The Windows lanes' matrix (e2e-windows.yml, desktop.yml test-windows): one entry per suite, or per slice of a sharded one.
export const windowsMatrix = (suites, shards = {}) => ({include: suites.flatMap(suite => shardLegs(suite, shards[suite]).map(leg => ({suite, ...leg})))});
