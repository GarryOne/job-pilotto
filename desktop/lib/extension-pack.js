// The Chrome extension arrives from the website, not from this app's files: its source is private, its CI publishes each
// version to the site (site/src/extension-pack.js), and this app downloads it when the site says the license or the trial
// allows it. It is kept in the data folder (extension/): Chrome loads it unpacked from there, and when a newer one is put in
// place the loaded extension reloads itself (extension/background.js asks the app for the latest version).
// Never throws: offline, a closed trial or a bad download leave what is installed as it was.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {installId} from './app-feedback.js';
import {log} from './log.js';
import {SITE, token} from './recipes.js';
import {tar} from './tar.js';

export const FOLDER = 'extension';
export const folder = storage => storage.path(FOLDER);

export function installedVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version || ''; } catch { return ''; }
}
const parts = text => String(text || '').split('.').map(part => Number(part) || 0);
export function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const unpack = (file, into) => new Promise((resolve, reject) => {
  fs.mkdirSync(into, {recursive: true});
  execFile(tar(), ['-xzf', file, '-C', into], {timeout: 60000}, error => (error ? reject(error) : resolve()));
});

// Put the package's files in `dir`, replacing what was there (the old copy is kept until the new one is in place).
async function install(dir, bytes, version, extract) {
  const work = `${dir}.new`, previous = `${dir}.previous`, file = `${dir}.download.tgz`;
  fs.rmSync(work, {recursive: true, force: true});
  fs.writeFileSync(file, bytes);
  try {
    await extract(file, work);
    const unpacked = installedVersion(work);
    if (unpacked !== version) throw new Error(`the package holds ${unpacked || 'no manifest'}, not ${version}`);
    fs.rmSync(previous, {recursive: true, force: true});
    if (fs.existsSync(dir)) fs.renameSync(dir, previous);
    fs.renameSync(work, dir);
    fs.rmSync(previous, {recursive: true, force: true});
  } finally {
    fs.rmSync(file, {force: true});
    fs.rmSync(work, {recursive: true, force: true});
  }
}

// Ask the site, download and install when newer. -> {ok, version, updated} | {ok: false, gate: 'license' | '', error}.
// The result is also kept in settings.extensionPack ({version, gate, checkedAt}) for Settings and the Jobs list.
export async function sync(storage, {fetcher = globalThis.fetch, base = SITE, extract = unpack, now = Date.now()} = {}) {
  const dir = folder(storage);
  const remember = patch => storage.saveSettings({extensionPack: {...(storage.settings().extensionPack || {}), checkedAt: new Date(now).toISOString(), ...patch}});
  try {
    const id = installId(storage);
    const headers = async () => ({Authorization: `Bearer ${await token(storage, fetcher, base)}`, 'X-Install': id,
      ...(storage.settings().license?.key ? {'X-License': storage.settings().license.key} : {})});
    let latest = await fetcher(`${base}/api/extension/latest`, {headers: await headers()});
    if (latest.status === 401) { storage.saveSettings({recipesToken: null}); latest = await fetcher(`${base}/api/extension/latest`, {headers: await headers()}); }
    const meta = await latest.json().catch(() => ({}));
    if (latest.status === 402) { remember({gate: 'license', version: installedVersion(dir)}); return {ok: false, gate: 'license', error: meta.error || 'A license key is needed.'}; }
    if (!latest.ok || !meta.version) throw new Error(meta.error || `latest ${latest.status}`);
    const have = installedVersion(dir);
    if (have && !newer(meta.version, have)) { remember({gate: '', version: have, via: meta.via || ''}); return {ok: true, version: have, updated: false}; }
    const response = await fetcher(`${base}/api/extension/download`, {headers: await headers()});
    if (!response.ok) throw new Error(`download ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== meta.hash) throw new Error('the download does not match its hash');
    await install(dir, bytes, meta.version, extract);
    remember({gate: '', version: meta.version, via: meta.via || ''});
    log('extension', `installed ${meta.version} from the site`, {previous: have || 'none', via: meta.via || ''});
    return {ok: true, version: meta.version, updated: true};
  } catch (error) {
    log('extension', `not updated: ${error.message}`);
    return {ok: false, gate: '', error: error.message};
  }
}

// Whether the extension is here and, if not, why: 'license' (the trial is over), or '' (not downloaded yet / offline).
export const status = storage => {
  const version = installedVersion(folder(storage));
  return {present: !!version, version, gate: (!version && storage.settings().extensionPack?.gate) || ''};
};
