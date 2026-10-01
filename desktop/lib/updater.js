// App updates: the installed app checks GitHub for the latest *stable* release (a build promoted with
// tools/release-stable.sh; every push only makes a pre-release), and installs it on one click, the same way on both
// computers: the download is fetched, the app quits, the new version is put in place, and the app reopens. On the Mac
// that means unpacking the .zip and swapping this Job Pilotto.app; on Windows, running the installer quietly once
// this process has let go of Job Pilotto.exe and its app.asar. Its Notion schema, pipeline and extension come with it
// (the schema repair runs at the next start).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = 'GarryOne/job-pilotto';

// "0.4.0-alpha.41" > "0.4.0-alpha.9" > "0.3.2"; a release (no suffix) > its pre-releases.
export function newer(a, b) {
  const parse = v => { const [core, pre = ''] = String(v).replace(/^desktop-v/, '').split('-'); return {core: core.split('.').map(Number), pre}; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.core[i] || 0) !== (y.core[i] || 0)) return (x.core[i] || 0) > (y.core[i] || 0);
  if (x.pre === y.pre) return false;
  if (!x.pre || !y.pre) return !x.pre;
  const [xa, ya] = [x.pre.split('.'), y.pre.split('.')];
  for (let i = 0; i < Math.max(xa.length, ya.length); i++) {
    if (xa[i] === ya[i]) continue;
    if (xa[i] === undefined || ya[i] === undefined) return ya[i] === undefined;
    const [xn, yn] = [Number(xa[i]), Number(ya[i])];
    return Number.isNaN(xn) || Number.isNaN(yn) ? xa[i] > ya[i] : xn > yn;
  }
  return false;
}

// The download for this computer in a release, or null.
export function asset(release, platform = process.platform) {
  const names = platform === 'darwin' ? [/^Job-Pilotto-[\d.]+.*-arm64\.zip$/, /^Job-Pilotto-mac-arm64\.zip$/]
    : platform === 'win32' ? [/^Job-Pilotto-windows-x64\.exe$/, /^Job-Pilotto-.*-x64\.exe$/] : [];
  for (const pattern of names) {
    const found = (release?.assets || []).find(item => pattern.test(item.name));
    if (found) return found;
  }
  return null;
}

// -> {version, name, notes, url} when the latest stable release is newer than `current`, else null.
export async function check(current, {fetcher = globalThis.fetch, platform = process.platform} = {}) {
  const response = await fetcher(`https://api.github.com/repos/${REPO}/releases/latest`, {headers: {Accept: 'application/vnd.github+json'}});
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = await response.json();
  const version = String(release.tag_name || '').replace(/^desktop-v/, '');
  const download = asset(release, platform);
  if (!version || !download || !newer(version, current)) return null;
  return {version, name: release.name || version, notes: String(release.body || '').slice(0, 2000), url: release.html_url,
    download: download.browser_download_url, size: download.size};
}

// The Mac swap, run after the app quits: wait for it, put the new .app in its place, open it.
export function macSwapScript(pid, oldApp, newApp) {
  const q = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
  return [`while kill -0 ${Number(pid)} 2>/dev/null; do sleep 0.3; done`,
    `rm -rf ${q(oldApp)}.old && mv ${q(oldApp)} ${q(`${oldApp}.old`)} && mv ${q(newApp)} ${q(oldApp)} && rm -rf ${q(`${oldApp}.old`)}`,
    `xattr -dr com.apple.quarantine ${q(oldApp)} 2>/dev/null`,
    `open ${q(oldApp)}`].join('\n');
}

// The Windows update, run after the app quits: wait for this process to end — it holds Job Pilotto.exe and the
// app.asar open, and the installer cannot replace either — then install it quietly (the silent per-user install the
// smoke test already proves) and reopen the app it just replaced. A quiet install shows no wizard at all, which is
// what makes this the same one-click update the Mac gets. PowerShell is on every Windows this runs on; the app is
// started again even if the installer fails, so a failed update leaves a working app rather than none.
export function windowsUpdateScript(pid, installer, exe) {
  const q = value => `'${String(value).replace(/'/g, "''")}'`;  // PowerShell: '' is a quote inside '…'
  return ['# Job Pilotto: update itself once this process has exited.',
    `Wait-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${q(installer)} -ArgumentList '/S' -Wait`,
    `Start-Process -FilePath ${q(exe)}`].join('\r\n') + '\r\n';
}

// Downloads and installs `update`; calls quit() when the app should close. onStep(text) for progress.
export async function install(update, {exe, pid = process.pid, quit, onStep = () => {}, fetcher = globalThis.fetch,
  platform = process.platform, spawn: run = spawn}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-pilotto-update-'));
  onStep('Downloading…');
  const response = await fetcher(update.download);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const file = path.join(dir, platform === 'win32' ? 'Job-Pilotto-Setup.exe' : 'update.zip');
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  if (platform === 'win32') {
    onStep('Installing and restarting…');
    const script = path.join(dir, 'update.ps1');
    fs.writeFileSync(script, windowsUpdateScript(pid, file, exe), 'utf8');
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      {detached: true, stdio: 'ignore', windowsHide: true}).unref();  // -ExecutionPolicy: a locked-down PC still runs it
    quit();
    return;
  }
  const oldApp = path.resolve(exe, '..', '..', '..');  // …/Job Pilotto.app/Contents/MacOS/Job Pilotto
  if (!oldApp.endsWith('.app') || oldApp.startsWith('/Volumes/')) throw new Error('Move Job Pilotto to Applications first, then update.');
  fs.accessSync(path.dirname(oldApp), fs.constants.W_OK);  // an Applications folder this user can write to
  onStep('Unpacking…');
  await new Promise((resolve, reject) => run('ditto', ['-x', '-k', file, dir]).on('exit', code => (code ? reject(new Error('Unpacking failed')) : resolve())));
  const newApp = fs.readdirSync(dir).map(name => path.join(dir, name)).find(name => name.endsWith('.app'));
  if (!newApp) throw new Error('The download has no app in it');
  onStep('Restarting…');
  run('/bin/sh', ['-c', macSwapScript(pid, oldApp, newApp)], {detached: true, stdio: 'ignore'}).unref();
  quit();
}
