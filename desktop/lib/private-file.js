// Writes a file only this user can read (0600), also when it already exists: Node's {mode} applies only to a NEW file, so a secrets file made earlier stayed 0644
// (13 Oct 2026: the test app's job-site passwords were readable by every account on the computer). Every private write goes through here; guard: test/private-file.test.js.
import fs from 'node:fs';

export function writePrivate(file, data) {
  fs.writeFileSync(file, data, {mode: 0o600});
  fs.chmodSync(file, 0o600);
}
