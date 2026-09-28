// The tar to run: on Windows the system's own (bsdtar, Windows 10+), named by its full path. A Git for Windows
// tar earlier on PATH is GNU tar, which reads "C:\..." as a remote host ("Cannot connect to C:").
import path from 'node:path';

export function tar(platform = process.platform, env = process.env) {
  return platform === 'win32' ? path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}
