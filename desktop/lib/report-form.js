// The app's side of "Report this form" (spec docs/superpowers/specs/2026-10-15-report-this-form.md §1-§3): what the extension's collector hands over (entries with their bodies in base64) becomes
// a record, is scrubbed (lib/report-scrub.js), searched again by the last gate, and held IN MEMORY with a preview the person can read; nothing is written to disk and nothing leaves. finalize()
// applies the hosts the person dropped and runs the gate once more: the record that comes out is the one that may be sent. Not wired to a route or a dialog yet (PR 4 and PR 5).
// Guard: test/report-recorder.test.js.
import crypto from 'node:crypto';
import {recordable, sha} from './net-keep.js';
import {lastGate, scrubRecord} from './report-scrub.js';

const TTL_MS = 15 * 60e3;
const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };

// The collector's entries (body: base64 | null) -> {entries, bodies}: a loopback address is never part of a record.
export function fromWire(entries = []) {
  const bodies = new Map(), out = [];
  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string' || !recordable(entry.url)) continue;
    const {body, ...rest} = entry, buffer = typeof body === 'string' ? Buffer.from(body, 'base64') : null, hash = buffer?.length ? sha(buffer) : '';
    if (hash) bodies.set(hash, buffer);
    out.push({...rest, hash, size: buffer?.length || 0});
  }
  return {entries: out, bodies};
}

// What the person reads before pressing Send: hosts (with how many responses and bytes), totals, and what the scrub took out. Counts and hosts only, never a value.
export function previewOf({entries, bodies, stats}) {
  const hosts = new Map();
  for (const entry of entries) {
    const host = hostOf(entry.url), one = hosts.get(host) || {host, responses: 0, bytes: 0};
    one.responses += 1; one.bytes += entry.hash ? bodies.get(entry.hash)?.length || 0 : 0; hosts.set(host, one);
  }
  const list = [...hosts.values()].sort((a, b) => b.responses - a.responses);
  const removed = {...stats.removed, images: stats.blanked || 0, dropped: Object.values(stats.dropped || {}).reduce((sum, n) => sum + n, 0)};
  return {hosts: list, responses: entries.length, bytes: list.reduce((sum, one) => sum + one.bytes, 0), removed};
}

// The collector's result -> {ok, held, preview} or {ok: false, blocked: [{kind, in}]} (the last gate found something: nothing is held).
export function prepare(wire, values = new Map()) {
  const scrubbed = scrubRecord(fromWire(wire.entries), values), hits = lastGate(scrubbed, values);
  if (hits.length) return {ok: false, blocked: hits};
  return {ok: true, held: {...scrubbed, truncated: !!wire.truncated}, preview: previewOf(scrubbed)};
}

// The record without the hosts the person dropped, searched once more. -> {ok, record} | {ok: false, blocked}
export function finalize(held, dropHosts = [], values = new Map()) {
  const drop = new Set(dropHosts), entries = held.entries.filter(entry => !drop.has(hostOf(entry.url)));
  const kept = new Set(entries.map(entry => entry.hash).filter(Boolean)), bodies = new Map([...held.bodies].filter(([hash]) => kept.has(hash)));
  const record = {entries, bodies, stats: held.stats}, hits = lastGate(record, values);
  return hits.length ? {ok: false, blocked: hits} : {ok: true, record};
}

// The held records: one per report, in memory, gone after 15 minutes or when taken. (The preview waits there while the person reads it.)
export function createHold({now = Date.now} = {}) {
  const held = new Map();
  const sweep = () => { for (const [id, one] of held) if (now() - one.at > TTL_MS) held.delete(id); };
  return {
    put(record) { sweep(); const id = crypto.randomUUID(); held.set(id, {record, at: now()}); return id; },
    take(id) { sweep(); const one = held.get(id); held.delete(id); return one?.record || null; },
    clear() { held.clear(); },
    size: () => { sweep(); return held.size; },
  };
}
