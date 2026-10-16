// The free trial as the server sees it (GET /api/trial/status): the app and the Always on runs on GitHub ask with the same install key (JPF1.<install>.<token>) and get the same answer.
// Trial = 20 applications or 60 days since the first run, whichever lasts longer (desktop/lib/license.js); over it, new work pauses unless Pro or licensed. Guard: site/test/trial.test.js.
// The caller reports `applied` and `first` (FSL accepts patching, 16 Oct 2026); the server keeps the highest count and the earliest first-run it has ever seen per install, so a lower number cannot reset the trial.
import {authorize} from './guard.js';
import {verifyLicense} from './license.js';
import {accountOf, planOn} from './pro.js';

export const FREE_APPLICATIONS = 20, FREE_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;
const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };

// Pure: where an install stands. -> {ended, used, limit, daysLeft}
export function stand({applied = 0, first, now = new Date()}) {
  const started = Date.parse(first) || now.getTime();
  const daysLeft = Math.max(0, Math.ceil(FREE_DAYS - (now.getTime() - started) / DAY));
  return {used: applied, limit: FREE_APPLICATIONS, daysLeft, ended: applied >= FREE_APPLICATIONS && daysLeft === 0};
}

export async function status(request, env, now = new Date()) {
  const given = parseKey(request.headers.get('x-api-key'));
  const access = given && await authorize(env, given.install, given.token, 'ai');
  if (!access?.ok) return Response.json({ok: false, error: 'unauthorized'}, {status: 401});
  const url = new URL(request.url), kv = env.WAITLIST;
  const asked = Math.max(0, Math.min(100000, Math.floor(Number(url.searchParams.get('applied')) || 0)));
  const askedFirst = Date.parse(url.searchParams.get('first'));
  const keys = {applied: `trial:applied:${access.who}`, first: `trial:first:${access.who}`};
  const [seenApplied, seenFirst] = kv ? await Promise.all([kv.get(keys.applied), kv.get(keys.first)]) : [null, null];
  const applied = Math.max(asked, Number(seenApplied) || 0);
  // The earliest first run known; never in the future, and the first request ever starts the clock.
  const known = [Date.parse(seenFirst), askedFirst].filter(time => time > 0 && time <= now.getTime());
  const first = new Date(known.length ? Math.min(...known) : now.getTime()).toISOString();
  if (kv) {
    if (applied !== Number(seenApplied)) await kv.put(keys.applied, String(applied));
    if (first !== seenFirst) await kv.put(keys.first, first);
  }
  const account = planOn(env) ? await accountOf(env, given.install) : null;
  const pro = account?.status === 'active';
  const license = !pro && await verifyLicense(request.headers.get('x-jp-license'), env.LICENSE_PUBLIC_KEY);   // founder / friend / pass key: no wall
  const state = stand({applied, first, now});
  const ended = state.ended && !pro && !license;
  // The pause line goes out at most once a day per install: a run that will send it asks with claim=1 and is told yes once (the last day lives here, not in the repo).
  let notify = false;
  if (ended && kv && url.searchParams.get('claim') === '1') {
    const today = now.toISOString().slice(0, 10), noticeKey = `trial:notice:${access.who}`;
    if (await kv.get(noticeKey) !== today) { await kv.put(noticeKey, today, {expirationTtl: 3 * 86400}); notify = true; }
  }
  return Response.json({ok: true, pro: !!pro, licensed: !!license, ...state, first, ended, notify});
}
