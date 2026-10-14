// The upload of "Report this form" (spec docs/superpowers/specs/2026-10-15-report-this-form.md §4, §6): the scrubbed record the person approved is packed (JSON, gzip), encrypted on this Mac with a
// random AES key that is itself wrapped with the owner's public key (lib/report-key.pem, the same key as e2e/net-record.pub.pem; only the owner's Keychain key opens it), and sent to the site with
// the install's own token for purpose "report". The site stores two opaque objects and cannot read them. Never sent when this run is not a real install (recipes.js siteIsOff: tests, the twin, CI).
// The ids of what was sent are kept (settings.reportsSent) so Settings can delete them. Guard: test/report-upload.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {installId} from './pool-share.js';
import {SITE, siteIsOff} from './recipes.js';

export const MAX_BYTES = 8 * 1024 * 1024;
const KEY_FILE = new URL('./report-key.pem', import.meta.url);

// The record as the offline loop reads it (a pool record: record.json + bodies/<hash>), marked as a person's. -> {record, bodies: {hash: base64}}
export function bundleOf({entries, bodies, stats}, now = Date.now()) {
  const first = entries.find(entry => entry.type === 'document') || entries[0], host = (() => { try { return new URL(first.url).host; } catch { return 'unknown'; } })();
  const name = `reported-${crypto.randomBytes(3).toString('hex')}-${host.split('.').slice(-2).join('.')}`;
  return {record: {name, where: 'person', source: 'person', startMs: now, seed: now, url: first?.url || '', unfinished: 0, unfinishedKinds: {}, entries, stats}, bodies: Object.fromEntries([...bodies].map(([hash, body]) => [hash, body.toString('base64')]))};
}

// -> {body: Buffer: iv(12) + tag(16) + ciphertext, wrapped: base64 of the AES key under the owner's public key}
export function encryptBundle(bundle, pem = fs.readFileSync(KEY_FILE, 'utf8')) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(bundle))), cipher.final()]);
  const wrapped = crypto.publicEncrypt({key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'}, key).toString('base64');
  return {body: Buffer.concat([iv, cipher.getAuthTag(), data]), wrapped};
}

export function createUploader({storage, fetcher = globalThis.fetch, base = SITE, pem, now = Date.now}) {
  const mint = async install => {
    const kept = storage.settings().reportToken;
    if (kept?.install === install && kept.value) return kept.value;
    const response = await fetcher(`${base}/api/install-token`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({install, purpose: 'report'})});
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.token) throw new Error(`The site gave no token (${response.status}).`);
    storage.saveSettings({reportToken: {install, value: body.token}});
    return body.token;
  };
  const headers = async install => ({'X-Install': install, Authorization: `Bearer ${await mint(install)}`});

  return {
    // -> {ok, id} | {ok: false, error}. A record is sent only after the person pressed Send and the gate ran a last time (report-handlers.js).
    async send(record, {cause = ''} = {}) {
      if (siteIsOff()) return {ok: false, error: 'This is not a regular install, so nothing is sent.'};
      const {body, wrapped} = encryptBundle(bundleOf(record, now()), pem);
      if (body.length > MAX_BYTES) return {ok: false, error: 'This report is too large to send. Untick the biggest site and try again.'};
      const install = installId(storage);
      const response = await fetcher(`${base}/api/report-form`, {method: 'POST', headers: {...(await headers(install)), 'X-Report-Key': wrapped, 'X-Report-Meta': JSON.stringify({requests: record.entries.length, cause}), 'Content-Type': 'application/octet-stream'}, body});
      const answer = await response.json().catch(() => ({}));
      if (response.status === 429) return {ok: false, error: 'You have sent the most reports for today. Try again tomorrow.'};
      if (!response.ok || !answer.id) return {ok: false, error: `The site did not take it (${response.status}). Nothing was kept there.`};
      storage.saveSettings({reportsSent: [...(storage.settings().reportsSent || []), {id: answer.id, at: now()}].slice(-50)});
      return {ok: true, id: answer.id};
    },
    count: () => (storage.settings().reportsSent || []).length,
    // Deletes every report this install sent that the site still holds. -> {ok, deleted}
    async deleteAll() {
      if (siteIsOff()) return {ok: false, deleted: 0};
      const install = installId(storage), sent = storage.settings().reportsSent || [], left = [];
      let deleted = 0;
      for (const one of sent) {
        const response = await fetcher(`${base}/api/report-form/${encodeURIComponent(one.id)}`, {method: 'DELETE', headers: await headers(install)}).catch(() => null);
        if (response?.ok || response?.status === 404) deleted += 1; else left.push(one);   // a 404 is already gone (30 days)
      }
      storage.saveSettings({reportsSent: left});
      return {ok: !left.length, deleted};
    },
  };
}
