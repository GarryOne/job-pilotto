// A suite that judges "which postings did the crawl keep?" must start from a store that remembers none of the fixture postings. The app finds jobs as soon as Notion connects
// (the connect-time Jobs check), with whatever strategy the shared Notion page held at that moment: the end state of the PREVIOUS run (the last step leaves it on the Giraffe role).
// Those postings stay in the local store and show up as "new" in the next digest even after the page is cleaned. 3 Oct 2026: strategy failed on "before any change the check finds
// neither new posting" after every run that had finished, and passed after every run that had failed early.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = `import sqlite3, sys
db = sqlite3.connect(sys.argv[1], timeout=20)
ids = [row[0] for row in db.execute("SELECT id FROM jobs WHERE url LIKE ?", (sys.argv[2] + "%",))]
for table, column in (("scores", "job_id"), ("jobs", "id")):
    try:
        db.executemany(f"DELETE FROM {table} WHERE {column} = ?", [(i,) for i in ids])
    except sqlite3.OperationalError:
        pass
db.commit()
print(len(ids))`;

// -> how many jobs were forgotten. `urlPrefix`: where the fixture boards say their postings live.
export function forgetFixtureJobs(profile, urlPrefix = 'https://boards.e2e.test/') {
  const database = path.join(profile, 'data', 'jobs.sqlite');
  if (!fs.existsSync(database)) return 0;
  return Number(execFileSync('python3', ['-c', SCRIPT, database, urlPrefix], {encoding: 'utf8'}).trim()) || 0;
}
