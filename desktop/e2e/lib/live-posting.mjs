// The posting a live run tries (lib/apply-live.mjs): LIVE_URL, else a real one from the owner's own job list, opened read-only. Its own file with no browser
// import, so the unit test (test/apply-live.test.js) runs where only desktop/node_modules exist (CI's desktop job has no playwright).
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// The posting to try: LIVE_URL, else a real one from the owner's own job list (the app's jobs.sqlite, opened read-only).
export function livePosting(env = process.env, run = execFileSync) {
  if (env.LIVE_URL) { const url = env.LIVE_URL.trim(); return {url, title: env.LIVE_TITLE || 'Live posting', company: env.LIVE_COMPANY || new URL(url).hostname, kit: []}; }
  const db = path.join(os.homedir(), 'Library/Application Support/Job Pilotto/data/jobs.sqlite');
  const like = env.LIVE_LIKE || '%jobs.coop.ch%';
  const row = run('sqlite3', ['-readonly', '-separator', '\t', db, `select jobs.title, companies.name, jobs.url from jobs join companies on companies.id = jobs.company_id where jobs.url like '${like.replace(/'/g, '')}' order by jobs.id desc limit 1`], {encoding: 'utf8'}).trim();
  if (!row) throw new Error(`no job in ${db} matches ${like}: set LIVE_URL=<a posting>`);
  const [title, company, url] = row.split('\t');
  return {url, title, company, kit: []};
}
