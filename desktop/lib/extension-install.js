// Is the Job Pilotto extension loaded in a Chromium browser on this Mac — and is it awake?
//
// The extension reports in every 30 s (extension/background.js) and that report is the only proof it is really
// running: it is what lets the app fill a form right now. But "no report" is not "not installed" — the browser may
// be closed, or the extension may simply be between alarms. The browser itself recorded the answer in its profile,
// so read that: a file read tells installed / turned off / open Chrome apart at once, instead of the app showing
// "Checking…" for a minute and then guessing (1 Oct 2026).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';

// The name in extension/manifest.json: how the extension is recognised whatever folder it was loaded from.
export const NAME = 'Job Pilotto';

// Chromium-family browsers that keep their extension records in <support>/<dir>/<Profile>/Secure Preferences.
export const BROWSERS = [
  {name: 'Google Chrome', dir: 'Google/Chrome', app: 'Google Chrome'},
  {name: 'Google Chrome Canary', dir: 'Google/Chrome Canary', app: 'Google Chrome Canary'},
  {name: 'Chromium', dir: 'Chromium', app: 'Chromium'},
  {name: 'Brave', dir: 'BraveSoftware/Brave-Browser', app: 'Brave Browser'},
  {name: 'Microsoft Edge', dir: 'Microsoft Edge', app: 'Microsoft Edge'},
  {name: 'Vivaldi', dir: 'Vivaldi', app: 'Vivaldi'},
];

const support = () => path.join(os.homedir(), 'Library', 'Application Support');
// Chrome's profile folders, without listing the browser's directory (a demo or test fixture only makes the ones it uses).
const profiles = () => ['Default', ...Array.from({length: 12}, (_, i) => `Profile ${i + 1}`)];
const parse = (file, read) => { try { return JSON.parse(read(file, 'utf8')); } catch { return null; } };

const real = at => { try { return fs.realpathSync(at); } catch { return path.resolve(at); } };

// The Job Pilotto records in one browser profile set: {id, profile, version, folder, enabled, unpacked} each.
// Secure Preferences first (that is where Chrome keeps extension settings now); Preferences for older browsers.
//
// Two shapes, and both matter: an extension from the Web Store (or one with a manifest "key") is recorded with its
// manifest — name and version — while an *unpacked* one is recorded as `location: 4` with only its PATH, no manifest
// at all. Matching on the name alone therefore missed the ordinary "Load unpacked" install that was sitting right
// there, and the app kept telling its owner to install what was already installed (1 Oct 2026).
export function inProfile(root, {read = fs.readFileSync, exists = fs.existsSync, list = profiles, folder = ''} = {}) {
  const ours = folder ? real(folder) : '';
  const found = [];
  for (const profile of list()) {
    for (const file of ['Secure Preferences', 'Preferences']) {
      const at = path.join(root, profile, file);
      if (!exists(at)) continue;
      const settings = parse(at, read)?.extensions?.settings;
      if (!settings) continue;
      for (const [id, entry] of Object.entries(settings)) {
        const named = entry?.manifest?.name === NAME;
        const byPath = entry?.location === 4 && !!ours && !!entry.path && real(entry.path) === ours;
        if (!named && !byPath) continue;
        found.push({id, profile, version: entry.manifest?.version || '', folder: entry.path || '',
          enabled: !(entry.disable_reasons || []).length, unpacked: entry.location === 4});
      }
    }
  }
  return found;
}

// Every browser on this Mac that has it. `current` marks the copy loaded from the app's own folder (in development
// <repo>/extension, packaged the app's resources): another copy is one the user made, and it stays behind when the
// app updates its own.
export function installed({folder = '', support: root = support(), browsers = BROWSERS, read = fs.readFileSync, exists = fs.existsSync} = {}) {
  const ours = folder ? real(folder) : '';
  const out = [];
  for (const browser of browsers) {
    const dir = path.join(root, browser.dir);
    if (!exists(dir)) continue;
    for (const entry of inProfile(dir, {read, exists, folder})) {
      out.push({browser: browser.name, app: browser.app, ...entry, current: !!ours && !!entry.folder && real(entry.folder) === ours});
    }
  }
  return out;
}

// Is that browser up? pgrep answers without any automation permission, and it is what tells "open Chrome" from
// "waiting for its next report".
export function running(app, {exec = execFile} = {}) {
  return new Promise(resolve => exec('/usr/bin/pgrep', ['-x', app], error => resolve(!error)));
}

// Chrome names an extension after its public key when its manifest pins one ("key", as this repo's does: the ID
// must not change with the folder), and after the absolute path it was loaded from otherwise. Either way the name is
// sha256 of those bytes, its first 128 bits, each nibble as a-p — so the app can open its own extension's pages
// (options, popup) with no browser help.
export function extensionId(folder, {read = fs.readFileSync} = {}) {
  let seed = path.resolve(String(folder));
  try {
    const key = JSON.parse(read(path.join(seed, 'manifest.json'), 'utf8'))?.key;
    if (key) seed = Buffer.from(key, 'base64');
  } catch { /* no manifest to read: the folder path is the seed, as Chrome would use */ }
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return [...hex].map(nibble => String.fromCharCode(97 + parseInt(nibble, 16))).join('');
}

// Open a URL in Chrome itself (the default browser may not be Chrome, and chrome:// pages only exist in Chrome).
export function openInChrome(url, {exec = execFile} = {}) {
  return new Promise(resolve => exec('/usr/bin/open', ['-a', 'Google Chrome', url], error => resolve(!error)));
}

// The two pages the install flow needs: Chrome's own extensions list, and the extension's options page, whose
// "Connect to the Job Pilotto app" is what makes it start reporting.
export const openExtensionsPage = (options = {}) => openInChrome('chrome://extensions', options);
export const openOptionsPage = (folder, options = {}) => openInChrome(`chrome-extension://${extensionId(folder)}/options.html`, options);
