// LibreOffice as an add-on, for a Word CV's PDF (owner, 24 Oct 2026: never in the installer, "download it when the user needs it"; Mac and
// Windows): a LibreOffice already on the computer is used as it is; otherwise one pinned release is downloaded once, checked against its
// published SHA-256 and unpacked into the app's folder (Mac: copied out of the disk image; Windows: an administrative install of the MSI,
// which only extracts files): nothing is installed system-wide and no admin rights are asked. While it is not there, the app draws the PDF
// itself (cv/docx-render.html). Guards: test/office.test.js; the real download on Mac and Windows: .github/workflows/office-addon.yml.
import {execFile} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const VERSION = '26.8.1';
const BASE = `https://download.documentfoundation.org/libreoffice/stable/${VERSION}`;
// One build per platform and processor; a platform not listed keeps the app's own renderer.
export const BUILDS = {
  'darwin-arm64': `mac/aarch64/LibreOffice_${VERSION}_MacOS_aarch64.dmg`,
  'darwin-x64': `mac/x86_64/LibreOffice_${VERSION}_MacOS_x86-64.dmg`,
  'win32-x64': `win/x86_64/LibreOffice_${VERSION}_Win_x86-64.msi`,
  'win32-arm64': `win/aarch64/LibreOffice_${VERSION}_Win_aarch64.msi`,
};

const runFile = (cmd, args, opts = {}) => new Promise((resolve, reject) =>
  execFile(cmd, args, {timeout: 10 * 60 * 1000, windowsHide: true, ...opts}, (error, stdout, stderr) => (error ? reject(Object.assign(error, {stderr})) : resolve({stdout, stderr}))));

// Where soffice is: in the app's own folder, else a LibreOffice the person installed. -> path or null
export function findOffice(dir, {platform = process.platform, exists = fs.existsSync, env = process.env} = {}) {
  const own = platform === 'darwin' ? [path.join(dir, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')]
    : [path.join(dir, 'program', 'soffice.exe'), path.join(dir, 'LibreOffice', 'program', 'soffice.exe')];
  const system = platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(os.homedir(), 'Applications', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')]
    : platform === 'win32' ? [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).map(root => path.join(root, 'LibreOffice', 'program', 'soffice.exe')) : ['/usr/bin/soffice', '/usr/local/bin/soffice'];
  return [...own, ...system].find(file => exists(file)) || null;
}

// Download to file, hashing as it goes. onProgress({step: 'download', share, bytes, total}) as it arrives. -> sha256 hex
async function download(url, file, {fetchImpl, onProgress}) {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`LibreOffice could not be downloaded (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0, hash = crypto.createHash('sha256'), out = fs.createWriteStream(file);
  let got = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk); got += chunk.length;
      if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
      onProgress?.({step: 'download', share: total ? got / total : null, bytes: got, total});
    }
  } finally { await new Promise(resolve => out.end(resolve)); }
  return hash.digest('hex');
}

let pending = null;
// Download, check and unpack LibreOffice into dir (once; a second call while one runs waits for it). -> soffice path
// key: `${platform}-${arch}`; run: execFile as a promise (a stub in tests); work: a temporary folder.
// onProgress({step, share, bytes, total}): step is 'download' (share 0-1 when the size is known), 'check', 'unpack', then 'ready'.
export function installOffice(dir, {key = `${process.platform}-${process.arch}`, fetchImpl = globalThis.fetch, run = runFile, onProgress, work = os.tmpdir()} = {}) {
  pending ??= (async () => {
    const build = BUILDS[key];
    if (!build) throw new Error(`No LibreOffice build for ${key}; the app's own renderer is used.`);
    const platform = key.split('-')[0];
    const temp = fs.mkdtempSync(path.join(work, 'jp-office-')), file = path.join(temp, path.basename(build));
    try {
      const want = (await (await fetchImpl(`${BASE}/${build}.sha256`)).text()).trim().split(/\s+/)[0];
      if (!/^[0-9a-f]{64}$/.test(want)) throw new Error('LibreOffice\'s checksum could not be read; nothing was installed.');
      const got = await download(`${BASE}/${build}`, file, {fetchImpl, onProgress});
      onProgress?.({step: 'check'});
      if (got !== want) throw new Error('The LibreOffice download did not match its checksum; nothing was installed.');
      onProgress?.({step: 'unpack'});
      const next = `${dir}.new`;
      fs.rmSync(next, {recursive: true, force: true}); fs.mkdirSync(next, {recursive: true});
      if (platform === 'darwin') {
        const mount = path.join(temp, 'mnt');
        fs.mkdirSync(mount);
        await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, file]);
        try { await run('ditto', [path.join(mount, 'LibreOffice.app'), path.join(next, 'LibreOffice.app')]); } finally { await run('hdiutil', ['detach', mount, '-force']).catch(() => {}); }
      } else {
        await run('msiexec', ['/a', file, '/qn', `TARGETDIR=${next}`]);
      }
      const soffice = findOffice(next, {platform, env: {}});
      if (!soffice) throw new Error('LibreOffice was unpacked but soffice was not found in it.');
      fs.rmSync(dir, {recursive: true, force: true}); fs.renameSync(next, dir);
      onProgress?.({step: 'ready'});
      return findOffice(dir, {platform, env: {}});
    } finally { fs.rmSync(temp, {recursive: true, force: true}); }
  })().finally(() => { pending = null; });
  return pending;
}

// A Word file to PDF with LibreOffice, in its own profile folder (never the person's LibreOffice settings). -> PDF bytes
export async function officePdf(soffice, bytes, {profile, run = runFile, work = os.tmpdir(), timeout = 120000} = {}) {
  const temp = fs.mkdtempSync(path.join(work, 'jp-docx-'));
  try {
    const input = path.join(temp, 'cv.docx');
    fs.writeFileSync(input, bytes);
    await run(soffice, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--norestore', '--nologo', '--convert-to', 'pdf', '--outdir', temp, input], {timeout});
    const pdf = path.join(temp, 'cv.pdf');
    if (!fs.existsSync(pdf)) throw new Error('LibreOffice made no PDF of this Word file.');
    return fs.readFileSync(pdf);
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
