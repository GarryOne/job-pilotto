// Varied starting data for the suites that read the fixture job feeds (fixtures/feeds, copied per run by lib/context.mjs): with a seed (lib/variation.mjs) the
// postings come in another order, one more matching role and one more wrong role are added, and Zurich is written another way. The suite then checks that the added
// match is kept and scored and the added wrong role is dropped. No seed (the release gate) = the feeds as written.
import fs from 'node:fs';
import path from 'node:path';

export const MATCHES = ['Site Reliability Engineer, Storage', 'Senior Platform Engineer, Developer Experience', 'DevOps Engineer, CI/CD', 'Staff Site Reliability Engineer'];
export const DECOYS = ['Account Executive, Enterprise', 'Senior Product Designer', 'Platform Engineering Intern', 'Account Executive, Switzerland'];
// The same city as people and boards write it.
export const ZURICH = ['Zurich, Switzerland', 'Zürich, Switzerland', 'Zurich, ZH, Switzerland', 'Zurich'];

const posting = (id, title, place) => ({id, title, location: {name: place}, absolute_url: `https://boards.e2e.test/job/${id}`, updated_at: '2026-10-02T09:00:00Z',
  content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in ${place}, English working language.</p>`});

// Returns {match, decoy, place, note} (null without a seed). Changes acme.json and beta.json in `dir` (the run's own copy).
export function varyFeeds(dir, vary) {
  if (!vary || vary.fixed) return null;
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const write = (name, feed) => fs.writeFileSync(path.join(dir, name), JSON.stringify(feed, null, 1));
  const acme = read('acme.json'), beta = read('beta.json');
  const match = vary.pick(MATCHES), decoy = vary.pick(DECOYS), place = vary.pick(ZURICH);
  for (const job of acme.jobs) if (/^Zurich, Switzerland$/.test(job.location?.name || '')) job.location.name = place;
  acme.jobs = vary.shuffle([...acme.jobs, posting(1201, match, place)]);
  beta.jobs = vary.shuffle([...beta.jobs, posting(2201, decoy, place)]);
  write('acme.json', acme);
  write('beta.json', beta);
  return {match, decoy, place, note: `feeds: +"${match}", decoy "${decoy}", Zurich as "${place}", shuffled`};
}
