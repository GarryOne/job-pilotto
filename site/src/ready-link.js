// Ready to send, the 10-minute link to one filled form (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): the owner's app asks for it with his install key and opens it in his browser, where the live view page
// (public/ready-live.html) cannot send a header. The link names one job and expires; it opens that job's live view and its "I submitted it", nothing else. Guard: site/test/ready-link.test.js.
import {equal, tokenFor} from './guard.js';

export const LINK_MINUTES = 10;
const macOf = (env, job, exp) => tokenFor(`${job}|${exp}`, env, 'ready-link');

// -> {url, expiresAt} for this job; `origin` is the site's own address.
export async function makeLink(env, job, origin, now = new Date()) {
  const exp = now.getTime() + LINK_MINUTES * 60 * 1000;
  return {url: `${origin}/ready-live?job=${encodeURIComponent(job)}&k=${exp}.${await macOf(env, job, exp)}`, expiresAt: new Date(exp).toISOString()};
}

// A request carrying ?job=&k= -> the owner's install when the link is good for that job and not expired, else null.
export async function viaLink(request, env, now = new Date()) {
  const url = new URL(request.url), job = url.searchParams.get('job') || '', [exp, mac = ''] = String(url.searchParams.get('k') || '').split('.');
  if (!job || !/^\d{10,15}$/.test(exp || '') || Number(exp) < now.getTime() || !mac || !env.READY_OWNER) return null;
  return equal(mac, await macOf(env, job, exp)) ? env.READY_OWNER : null;
}
