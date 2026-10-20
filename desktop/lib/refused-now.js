// "Read now" for refused sites (owner, 20 Oct 2026): opening a job from a site in the app, or pressing Check for new jobs, makes the sites that refused the engine due at once,
// through the same ladder as the schedule. This file holds only that request (shared by pipeline-tasks.js, the job-open path and refused-reads.js, so none imports another).
// Guard: test/refused-reads.test.js.
let hosts = new Set();
let everything = false;

export const hostOf = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
export function readNow(url) { const host = hostOf(url); if (host) hosts.add(host); }   // one site: the person opened a job there
export function readAllNow() { everything = true; }                                      // Check for new jobs: every refused site that is due or resting
export const pending = () => everything || hosts.size > 0;
export function take() { const taken = {all: everything, hosts: [...hosts]}; hosts = new Set(); everything = false; return taken; }
