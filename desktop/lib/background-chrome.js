// A Chrome an automation left behind is not just clutter: macOS keeps ONE Apple Event connection per application, and
// a background Chrome that registered first holds it — so every window the user actually has becomes invisible to
// Chrome's own scripting (focus, reload, close), and the app reports "no tab matches" about a tab that is right
// there (1 Oct 2026: a headless Chrome from a run two hours earlier).
//
// Only an *orphaned* one is ever offered to quit: its launcher is gone (parent 1), so nothing is driving it. A running
// automation's Chrome has a live parent and is left alone.
import {execFile} from 'node:child_process';

const PS = ['-Ao', 'pid=,ppid=,lstart=,command='];
const run = (file, args) => new Promise(resolve => execFile(file, args, {maxBuffer: 1 << 20}, (error, stdout) => resolve(error ? '' : String(stdout))));
// The browser process itself (not a helper), and one that has no window of its own to show.
const BROWSER = /Google Chrome\.app\/Contents\/MacOS\/Google Chrome\b/;
const HEADLESS = /--headless|--no-startup-window/;

// `ps` lines -> the orphaned, windowless Chrome browsers. Pure, so the shape of that output is a tested thing.
export function parseChromeProcesses(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/);
    if (!match) continue;
    const [, pid, ppid, since, command] = match;
    if (!BROWSER.test(command) || !HEADLESS.test(command)) continue;
    if (ppid !== '1') continue;  // still owned by a script: an automation at work, not ours to touch
    out.push({pid: Number(pid), ppid: Number(ppid), since, profile: (command.match(/--user-data-dir=(\S+)/) || [])[1] || ''});
  }
  return out;
}

// The strays on this Mac right now (none on anything but macOS).
export async function stray({exec = run, platform = process.platform} = {}) {
  if (platform !== 'darwin') return [];
  return parseChromeProcesses(await exec('/bin/ps', PS));
}

// Quit one of them: only a pid this module has just reported, never a bare number from a caller.
export async function quit(pid, {list = stray, kill = process.kill.bind(process)} = {}) {
  const found = (await list()).find(entry => entry.pid === Number(pid));
  if (!found) return {ok: false, error: 'That Chrome is no longer a stray one.'};
  try { kill(found.pid, 'SIGTERM'); return {ok: true, pid: found.pid}; }
  catch (error) { return {ok: false, error: error.message}; }
}
