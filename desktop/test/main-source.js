// The main process's source as tests read it: main.js and the handler files split out of it (lib/*-handlers.js, lib/session-flow.js),
// so a test that checks "this IPC is handled" or "this wiring exists" keeps working when main.js is split (8 Oct 2026, the 500-line rule).
import fs from 'node:fs';
import path from 'node:path';

const desktop = path.resolve(import.meta.dirname, '..');
export function mainSource() {
  const lib = path.join(desktop, 'lib');
  const parts = fs.readdirSync(lib).filter(name => /-handlers\.js$|^session-flow\.js$|^app-[\w-]+\.js$|^(main-window|cv-windows)\.js$/.test(name)).sort().map(name => fs.readFileSync(path.join(lib, name), 'utf8'));
  return [fs.readFileSync(path.join(desktop, 'main.js'), 'utf8'), ...parts].join('\n');
}
