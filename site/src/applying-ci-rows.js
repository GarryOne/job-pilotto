// PUT /applying/ci-rows: a CI recording run's row results reach /admin/lab-form-filling's pool table (owner, 14 Oct 2026: the CI pool workflow's one job is recording, so its rows must move the page).
// Narrow key (Bearer REPLAYS_PUBLISH_KEY, a wrong or missing one is a 404 as the other publish routes), and ONLY a run on main: a branch's work in progress once showed main as broken (12 Oct),
// so the body names its branch and anything but "main" is refused. Rows go through the same ingest as the Mac's uploads (src/applying.js), stored as main's runs. Guard: test/applying-ci-rows.test.js.
import {ingest} from './applying.js';
import {equal} from './guard.js';
import {CI_BLOCKED, isRefusal} from './applying-status.js';

// A refusal seen from CI is the data-centre's: stored as "blocked in CI", never as the site's own refusal (the Mac's upload keeps its word). No site is named: any refusal from this route.
const ciRows = rows => (Array.isArray(rows) ? rows.map(row => (isRefusal(row?.note) ? {...row, note: CI_BLOCKED} : row)) : rows);

export async function ciRowsIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.json().catch(() => null);
  const result = body?.branch === 'main' ? await ingest(env.STATS, {kind: 'smoke', day: body.day, version: body.version, onMain: true, rows: ciRows(body.rows)}, now) : {ok: false, error: 'only a run on main reaches the page'};
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}
