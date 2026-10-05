// The private playbook for Claude's application sessions: per-board notes (how Greenhouse, Ashby, Lever ... really behave), learned over
// many applications. It is served one board at a time to installs with a token, so the public skill stays generic and the learned part
// stays ours (Notion: "Intellectual Property"). Stored in KV (binding WAITLIST) as `playbook:<board>`.
//   GET /api/playbook?board=greenhouse   Bearer <recipes token> + X-Install-Id: {board, text}  (a few boards a day per install)
//   PUT /api/playbook                    the owner's key: {board, text} (the private repo's playbooks/ publishes here)
import {authorize, flag} from './guard.js';
import {isOwner} from './stats.js';

const BOARD = /^[a-z0-9-]{2,30}$/, MAX_TEXT = 40000, PER_INSTALL_PER_DAY = 30;
const day = date => date.toISOString().slice(0, 10);
const json = (body, status = 200, headers = {}) => Response.json(body, {status, headers: {'Cache-Control': 'private, no-store', ...headers}});

export async function playbook(request, env, now = new Date()) {
  if (!env.WAITLIST) return json({ok: false, error: 'not configured'}, 503);
  if (request.method === 'PUT') {
    if (!await isOwner(request, env)) return new Response('Not found', {status: 404});
    const body = await request.json().catch(() => ({}));
    const board = String(body.board || '').toLowerCase(), text = String(body.text ?? '');
    if (!BOARD.test(board) || text.length > MAX_TEXT) return json({ok: false, error: 'bad board or text too long'}, 400);
    await env.WAITLIST.put(`playbook:${board}`, JSON.stringify({text, updated: now.toISOString()}));
    return json({ok: true, board, chars: text.length});
  }
  if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  const install = request.headers.get('X-Install-Id') || '';
  const access = await authorize(env, install, (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), 'recipes');
  if (!access.ok) return json({ok: false, error: 'unauthorized'}, 401);
  const board = String(new URL(request.url).searchParams.get('board') || '').toLowerCase();
  if (!BOARD.test(board)) return json({ok: false, error: 'bad board'}, 400);
  const key = `playbook-get:${install}:${day(now)}`;
  const used = Number(await env.WAITLIST.get(key)) || 0;
  if (used >= PER_INSTALL_PER_DAY) { await flag(env, 'quota', access.who, 'playbook', now); return json({ok: false, error: 'limit reached for today'}, 429); }
  await env.WAITLIST.put(key, String(used + 1), {expirationTtl: 2 * 86400});
  const stored = await env.WAITLIST.get(`playbook:${board}`);
  return json({ok: true, board, text: stored ? JSON.parse(stored).text : ''});
}
