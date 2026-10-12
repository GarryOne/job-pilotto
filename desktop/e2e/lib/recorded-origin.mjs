// Where a recorded case's page came from (owner, 12 Oct 2026, via job-pilotto-cc: a green replay proves a mechanism on a small page, not a site): every case.json says
// `origin`: 'captured' (the markup came from a real page: saved by a run or copied, then scrubbed or reduced) or 'hand-cut' (written by hand: invented, reconstructed from a sketch or
// a screenshot, rebuilt small). /admin/applying shows it per case (site/src/applying-cases.js). Guard: desktop/test/recorded-origin.test.js fails a case without it.
export const ORIGINS = ['captured', 'hand-cut'];
export const originOf = item => (ORIGINS.includes(item?.origin) ? item.origin : null);
