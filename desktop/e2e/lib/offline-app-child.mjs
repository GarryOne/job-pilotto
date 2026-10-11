// The app's own extension server (desktop/lib/server.js, the same decision modules a person's app runs) under plain node, for an offline row replay (speed-5x
// landing 2, owner 11 Oct 2026). Started by lib/offline-app.mjs in its own process: the server reads its port at import time, and this process's network is
// cut to loopback (guardNetwork) while the model is answered from the row's kept answers only (memo-only; `claude -p` only when the caller asks).
// Its folder holds the fake applicant only (fixtures/cv.pdf, a profile with the stand-in contact): never the person's data. Prints one JSON line when ready.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {guardNetwork} from './offline-guard.mjs';
import {realClaude} from './real-claude.mjs';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.env.JOB_PILOTTO_USER_DATA;
if (!dir || !process.env.JOB_PILOTTO_E2E || !process.env.JOB_PILOTTO_PORT) throw new Error('offline app: start it through lib/offline-app.mjs (e2e env, own folder, own port)');
guardNetwork();
// A positive control: the guard took effect in this process (an outward fetch is refused and named) before anything is served.
const guarded = await fetch('https://example.com/').then(() => false, error => /offline: example\.com/.test(String(error?.message || error)));
if (!guarded) throw new Error('offline app: the network guard did not take effect');

// The stand-in applicant, as the profile's contact section a person's app keeps (lib/contact.js reads it).
const OFFLINE_PROFILE = `# Profile

## 📇 Contact details
First name: Test
Last name: Candidate
Email: test.candidate@example.com
Phone: +41 00 000 00 00
City: Zurich
Country: Switzerland
LinkedIn: https://www.linkedin.com/in/test-candidate-example
`;

fs.mkdirSync(dir, {recursive: true});
fs.writeFileSync(path.join(dir, 'profile.md'), OFFLINE_PROFILE);
fs.copyFileSync(path.join(E2E, 'fixtures', 'cv.pdf'), path.join(dir, 'cv.pdf'));
const {logTo} = await import('../../lib/log.js');
logTo(path.join(dir, 'logs'));
const {createStorage} = await import('../../lib/storage.js');
const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
storage.saveSettings({aiEngine: 'cli', claudeCode: {path: realClaude()}, store: 'sqlite', setupDone: true, cvName: 'cv.pdf', telemetry: false, shareEmployers: false});
const {start, PORT, EXTENSION_ID} = await import('../../lib/server.js');
const {extensionToken} = await import('../../lib/server-env.js');
if (String(PORT) !== process.env.JOB_PILOTTO_PORT) throw new Error(`offline app: the server took port ${PORT}, not ${process.env.JOB_PILOTTO_PORT}`);
const server = start(storage, error => console.error(`offline app: server error ${error?.message || error}`));
await new Promise(resolve => server.once('listening', resolve));
console.log(JSON.stringify({ready: true, guarded, port: PORT, token: extensionToken(storage), extensionId: EXTENSION_ID, dir}));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
