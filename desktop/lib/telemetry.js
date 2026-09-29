// Technical reports (on by default; Settings → Advanced turns them off): crashes, failed runs, form issues and a
// daily health line, so problems every user hits can be found and fixed for everyone. Scrubbed here, before
// anything leaves the Mac: no answers, CV, emails, names, phone numbers, keys, file paths or link queries.
// Queued in telemetry-queue.json and sent in batches to the website (POST /report/telemetry); an offline Mac
// loses nothing. The last 20 events stay visible in Settings ("See what's sent"). Design: Notion "📡 Technical
// reports (telemetry) — design".
import crypto from 'node:crypto';
import os from 'node:os';

export const ENDPOINT = 'https://www.jobpilotto.workers.dev/report/telemetry';
const QUEUE = 'telemetry-queue.json';
const MAX_QUEUE = 500, SHOWN = 20, BATCH = 50;
export const KINDS = ['crash', 'run_failed', 'form_issue', 'stuck', 'health'];

// Personal or secret data out of any text: keys and tokens, emails, phone numbers, the user's home folder, link
// queries and fragments, long digit runs (IDs, card-like numbers). Then cut to `max` characters.
export function scrub(value, max = 500, home = os.homedir()) {
  let text = String(value ?? '');
  const secrets = [/sk-ant-[\w-]+/g, /\bntn_\w+/g, /\bsecret_\w+/g, /\bgh[pousr]_\w+/g, /github_pat_\w+/g, /GOCSPX-[\w-]+/g,
    /\b\d{6,12}:AA[\w-]{20,}/g, /\bxox[abprs]-[\w-]+/g, /\bBearer\s+[\w.-]+/gi, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g];
  for (const pattern of secrets) text = text.replace(pattern, '<secret>');
  if (home && home.length > 1) text = text.split(home).join('~');
  text = text.replace(/\/(Users|home)\/[^/\s"']+/g, '/$1/<user>').replace(/[A-Z]:\\Users\\[^\\\s"']+/gi, 'C:\\Users\\<user>');
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  text = text.replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1');
  text = text.replace(/\+?\d[\d ()-]{7,}\d/g, '<number>');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// One event: its kind, its own safe fields (every string scrubbed, shallow), and who/what/when without identity.
export function event(kind, fields, {install, version, platform = process.platform, osVersion = os.release(), now = Date.now()}) {
  const safe = {};
  for (const [key, value] of Object.entries(fields || {}).slice(0, 20)) {
    if (value == null) continue;
    safe[scrub(key, 40)] = typeof value === 'number' || typeof value === 'boolean' ? value
      : Array.isArray(value) ? value.slice(0, 20).map(item => scrub(item, 120)) : scrub(value, key === 'stack' ? 2000 : 500);
  }
  return {kind: KINDS.includes(kind) ? kind : 'crash', at: new Date(now).toISOString(), install, version, platform, os: osVersion, ...safe};
}

export function create(storage, {version, fetcher = globalThis.fetch, endpoint = ENDPOINT, now = () => Date.now()} = {}) {
  const enabled = () => storage.settings().telemetry !== false;
  const install = () => {
    let id = storage.settings().telemetryId;
    if (!id) { id = crypto.randomUUID(); storage.saveSettings({telemetryId: id}); }
    return id;
  };
  const load = () => { try { return JSON.parse(storage.readText(QUEUE) || '{}'); } catch { return {}; } };
  const save = data => storage.writeText(QUEUE, JSON.stringify(data));
  let sending = false;
  return {
    enabled,
    // Record one event (nothing when the user turned reports off). Never throws.
    record(kind, fields = {}) {
      try {
        if (!enabled()) return null;
        const item = event(kind, fields, {install: install(), version, now: now()});
        const data = load();
        data.queue = [...(data.queue || []), item].slice(-MAX_QUEUE);
        data.shown = [item, ...(data.shown || [])].slice(0, SHOWN);
        save(data);
        return item;
      } catch { return null; }
    },
    shown: () => load().shown || [],
    // Send what's queued, in batches; what the server took is removed. Off: the queue is dropped, nothing sent.
    async flush() {
      if (sending) return 0;
      const data = load();
      if (!enabled()) { if (data.queue?.length) save({...data, queue: []}); return 0; }
      if (!data.queue?.length) return 0;
      sending = true;
      let sent = 0;
      try {
        while (data.queue.length) {
          const batch = data.queue.slice(0, BATCH);
          const response = await fetcher(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({events: batch})});
          if (!response.ok) break;
          data.queue = data.queue.slice(batch.length);
          sent += batch.length;
          save(data);
        }
      } catch { /* offline: kept for the next try */ } finally { sending = false; }
      return sent;
    },
  };
}
