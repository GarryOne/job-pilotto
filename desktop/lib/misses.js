// Controls the form reader could not read, kept on this Mac (extension/review.js -> /extension/misses): the first step of
// learning how to operate them. One entry per structural fingerprint (extension/page/skeleton.js): what the control is
// made of (no text, no values), the question it answered, how often and where it was seen. Nothing leaves the Mac yet.
// A cache: it can be deleted and is rebuilt as forms are visited.
import {log} from './log.js';

export const FILE = 'misses.json';
export const MAX_ENTRIES = 200;
export const KEEP_DAYS = 30;
const MAX_SKELETON = 6000;   // characters of JSON
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function read(storage) {
  try { const list = JSON.parse(storage.readText(FILE) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}

// payload {host, items: [{fingerprint, kind, skeleton, question}]} merged into the list; old and surplus entries dropped.
export function merge(list, payload, now = Date.now()) {
  const host = clip(payload?.host, 80);
  const byKey = new Map(list.map(entry => [entry.fingerprint, entry]));
  let fresh = 0;
  for (const item of Array.isArray(payload?.items) ? payload.items.slice(0, 10) : []) {
    const fingerprint = clip(item?.fingerprint, 24);
    if (!/^[a-z0-9]{6,16}$/.test(fingerprint)) continue;
    const skeleton = JSON.stringify(item.skeleton ?? null);
    if (skeleton.length > MAX_SKELETON) continue;
    const entry = byKey.get(fingerprint) || {fingerprint, kind: clip(item.kind, 24), skeleton: item.skeleton, firstSeen: now, count: 0, hosts: [], questions: []};
    if (!byKey.has(fingerprint)) fresh++;
    entry.count += 1;
    entry.lastSeen = now;
    if (host && !entry.hosts.includes(host) && entry.hosts.length < 5) entry.hosts.push(host);
    const question = clip(item.question, 120);
    if (question && !entry.questions.includes(question) && entry.questions.length < 5) entry.questions.push(question);
    byKey.set(fingerprint, entry);
  }
  const cutoff = now - KEEP_DAYS * 86400000;
  const kept = [...byKey.values()].filter(entry => entry.lastSeen >= cutoff).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX_ENTRIES);
  return {list: kept, fresh};
}

export function record(storage, payload, now = Date.now()) {
  try {
    const {list, fresh} = merge(read(storage), payload, now);
    storage.writeText(FILE, JSON.stringify(list));
    // Decisions, not content: which kinds and fingerprints, how many are new (never the questions' text).
    if (fresh) log('misses', `${fresh} new control(s) the form reader could not read`,
      {host: clip(payload?.host, 80), fingerprints: (payload.items || []).map(item => clip(item?.fingerprint, 16)).slice(0, 10)});
    return {ok: true, fresh};
  } catch (error) {
    log('misses', `not kept: ${error.message}`);
    return {ok: false};
  }
}
