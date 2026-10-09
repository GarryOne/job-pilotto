// Product analytics (PostHog, EU cloud) without PostHog's SDK: which steps people take and where they stop (setup, first search, kit,
// apply, applied), so the funnel and the paths can be read in PostHog. Only events from the list below, only short flags, numbers and
// scrubbed words as properties, never anything a person wrote or read in the app (no CV, jobs, companies, answers, mail). The id is the
// random install id; no person profile, no IP-based location, no screen recording, no autocapture. Follows the same
// "Technical reports" switch as everything else that leaves this computer.
import {scrub} from './telemetry.js';

export const EVENTS = ['app_start', 'page_view', 'setup_step', 'search_done', 'first_search_done', 'kit_prepared', 'apply_started', 'applied',
  'feedback_sent', 'update_installed'];
export const PAGES = ['focus', 'jobs', 'sessions', 'actions', 'calendar', 'interviews', 'strategy', 'settings', 'reports'];
const FLUSH_AT = 20, FLUSH_MS = 30_000, QUEUE_MAX = 100;

// Properties: lower-case names, and values that are a flag, a number, or a short word (a mode, a page, a step), scrubbed.
export function cleanProps(props = {}) {
  const out = {};
  for (const [name, value] of Object.entries(props || {}).slice(0, 12)) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(name)) continue;
    if (typeof value === 'boolean') out[name] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[name] = Math.round(value * 100) / 100;
    else if (typeof value === 'string' && /^[\w .:+-]{1,40}$/.test(value)) out[name] = scrub(value, 40);
  }
  return out;
}

export function create({key, host = 'https://eu.i.posthog.com', installId, version, platform = process.platform, os = '', enabled = () => true,
  fetcher = globalThis.fetch, now = () => Date.now(), timers = true} = {}) {
  let queue = [], timer = null, sending = false;
  const active = !!key;
  async function flush() {
    if (!active || !queue.length || sending) return false;
    sending = true;
    const batch = queue.splice(0, 50);
    try {
      const response = await fetcher(`${host}/batch/`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({api_key: key, batch})});
      if (response && response.ok === false) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch {
      queue = [...batch, ...queue].slice(0, QUEUE_MAX);   // kept for the next try, never grown without limit
      return false;
    } finally { sending = false; }
  }
  function track(event, props = {}) {
    try {
      if (!active || !enabled() || !EVENTS.includes(event)) return false;
      queue.push({event, distinct_id: installId, timestamp: new Date(now()).toISOString(),
        properties: {...cleanProps(props), app_version: version, platform, os: String(os).slice(0, 20), $lib: 'job-pilotto', $process_person_profile: false, $geoip_disable: true}});
      if (queue.length > QUEUE_MAX) queue.shift();
      if (queue.length >= FLUSH_AT) void flush();
      else if (timers && !timer) { timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS); timer.unref?.(); }
      return true;
    } catch { return false; }
  }
  return {active, track, flush, pending: () => queue.length};
}
