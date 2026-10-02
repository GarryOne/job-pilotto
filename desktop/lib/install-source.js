// Where an install came from: the website's install command carries the channel (curl …/install?src=reddit-devops), and
// the installer leaves it in <userData>/install-source.txt. At start the app takes it once and keeps it with its other
// settings; its reports then say which channel it came from (lib/telemetry.js), so /telemetry can show which channel
// brings people who finish setup. A label like "reddit-devops", never a person. The first channel stays: an update
// through another link doesn't change where the app was first installed from.
import fs from 'node:fs';
import path from 'node:path';

export const FILE = 'install-source.txt';
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,39}$/;

export function consume(dir, storage) {
  const file = path.join(dir, FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8').trim().toLowerCase(); } catch { return null; }
  fs.rmSync(file, {force: true});  // taken once, whatever happens next
  if (!SLUG.test(text) || storage.settings().installSource) return null;
  storage.saveSettings({installSource: text});
  return text;
}
