// Which browser profile a launch should use, so Chrome opens the page instead of its "Who's using Chrome?" picker.
// Guarded by test/browser-launch-profile.test.js.
import fs from 'node:fs';
import path from 'node:path';

// Where each browser keeps its user data, below %LOCALAPPDATA% (PC) or ~/Library/Application Support (Mac), by app name.
const DATA = {
  'Google Chrome': ['Google/Chrome', 'Google/Chrome/User Data'],
  'Microsoft Edge': ['Microsoft Edge', 'Microsoft/Edge/User Data'],
  'Brave Browser': ['BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser/User Data'],
  'Vivaldi': ['Vivaldi', 'Vivaldi/User Data'],
};

// The profile folder name the browser used last ("Default", "Profile 2"), from its Local State; '' when unknown.
// With 2+ profiles and "Show on startup" the browser asks who is using it and drops the URL it was handed, unless a
// profile is named (owner's PC, 13 Oct 2026). The last-used one is what it would open anyway without the picker.
// Only the env passed in is read, never os.homedir(): a test without a fake home gets '' and touches no real profile.
export function lastUsedProfile(app, platform = process.platform, env = process.env, read = fs.readFileSync) {
  const dirs = DATA[app];
  const root = platform === 'win32' ? env.LOCALAPPDATA : env.HOME && path.join(env.HOME, 'Library', 'Application Support');
  if (!dirs || !root) return '';
  const p = platform === 'win32' ? path.win32 : path;
  try {
    const last = JSON.parse(read(p.join(root, dirs[platform === 'win32' ? 1 : 0], 'Local State'), 'utf8'))?.profile?.last_used;
    return typeof last === 'string' && /^[\w .-]{1,40}$/.test(last) ? last : '';   // a folder name, never a path or a flag
  } catch { return ''; }
}
