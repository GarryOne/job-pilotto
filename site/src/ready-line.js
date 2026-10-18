// Ready to send, a night's forms in a line (owner, 18 Oct 2026, sketch: "one server, forms in a line", a bar and a live line per row, Stop per row and for the night):
// the container reports the step each form is on (fixed words, never page text), and the owner's Stop puts a waiting or filling form back to how it was before
// the press (the result a Fill again replaced) or marks it stopped; a night with nothing left to fill ends. Guard: site/test/ready-line.test.js.

// The steps the container may report (hosted/ready-fill/fill-job.mjs); the app words each one (desktop/renderer/pages/ready-rows.js).
export const STEPS = ['opening', 'form', 'filling', 'answering', 'reading'];
export const LIVE = "('queued', 'filling')";   // a row the night still works on: waiting its turn or filling
const RESULT = ['state', 'filled', 'left_empty', 'human_check', 'wall', 'ms', 'at'];
const stamp = at => at.toISOString();

// POST (night token) {job, step, n}: the row's live step. The answer tells the container to drop this form: `stop` when the row was stopped (or is gone).
export async function progress(env, night, given, now = new Date()) {
  const job = String(given?.job || ''), step = String(given?.step || '');
  if (!STEPS.includes(step)) return {status: 400, body: {ok: false, error: 'bad step'}};
  const n = Number.isInteger(given?.n) && given.n >= 0 ? Math.min(given.n, 9999) : null;
  const changed = await env.STATS.prepare(`UPDATE ready_jobs SET state = 'filling', step = ?, step_n = ?, started_at = COALESCE(started_at, ?) WHERE batch = ? AND job = ? AND cleared_at IS NULL AND state IN ${LIVE}`)
    .bind(step, n, stamp(now), night.id, job).run();
  return {status: 200, body: {ok: true, stop: !changed.meta?.changes}};
}

// What a Fill again keeps of a row's result, to put back if it is stopped. -> the UPDATE that queues the row again.
export async function requeue(env, batch, job) {
  const row = await env.STATS.prepare(`SELECT ${RESULT.join(', ')} FROM ready_jobs WHERE batch = ? AND job = ?`).bind(batch, job).first();
  const before = row && row.state !== 'queued' ? JSON.stringify(row) : null;
  return env.STATS.prepare(`UPDATE ready_jobs SET state = 'queued', filled = NULL, left_empty = NULL, human_check = NULL, wall = NULL, ms = NULL, at = NULL, step = NULL, step_n = NULL, started_at = NULL,
    again_from = COALESCE(?, again_from), turn = turn + 1 WHERE batch = ? AND job = ?`).bind(before, batch, job);
}

// A stopped row: back to the result a Fill again replaced, or "stopped" when it had none.
function putBack(env, batch, row, now) {
  const before = (() => { try { return JSON.parse(row.again_from || 'null'); } catch { return null; } })();
  const fields = before ? RESULT.map(name => before[name] ?? null) : ['stopped', null, null, null, '', null, stamp(now)];
  return env.STATS.prepare(`UPDATE ready_jobs SET ${RESULT.map(name => `${name} = ?`).join(', ')}, step = NULL, step_n = NULL, started_at = NULL, again_from = NULL WHERE batch = ? AND job = ?`)
    .bind(...fields, batch, row.job);
}

// POST (owner) {job} or {}: Stop one form, or every form of the night still waiting or filling. The container learns it at its next step (progress answers stop)
// or from the night's end (its token stops working); a stopped form's late result is dropped (ready.js result). -> {status, body}
export async function stop(env, install, job, now = new Date()) {
  const night = await env.STATS.prepare("SELECT id FROM ready_batches WHERE install = ? AND state IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1").bind(install).first();
  const {results} = night ? await env.STATS.prepare(`SELECT job, again_from FROM ready_jobs WHERE batch = ? AND cleared_at IS NULL AND state IN ${LIVE}${job ? ' AND job = ?' : ''}`)
    .bind(night.id, ...(job ? [job] : [])).all() : {results: []};
  if (!results.length) return {status: 404, body: {ok: false, error: 'nothing is filling'}};
  await env.STATS.batch(results.map(row => putBack(env, night.id, row, now)));
  const left = (await env.STATS.prepare(`SELECT COUNT(*) AS n FROM ready_jobs WHERE batch = ? AND state IN ${LIVE}`).bind(night.id).first()).n;
  if (!left) await env.STATS.prepare('UPDATE ready_batches SET state = \'finished\', finished_at = ? WHERE id = ?').bind(stamp(now), night.id).run();
  return {status: 200, body: {ok: true, stopped: results.length}};
}
