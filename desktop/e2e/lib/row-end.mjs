// When a row replay may end (npm run row, the recorded-pages job: each replay used to run to its 90 s cap whenever a model ask missed its kept answer: the extension retried, the request count never stood
// still; 12 Oct 2026): the page and the extension are quiet for STILL ms (lib/live-still.mjs's clock: requests, page log lines, tabs), AND the live run's presses are all made (else the wait is three times as
// long, then the unmade press is the finding), OR a cold ask has waited out 15 s (the case fails on it anyway). Never before the last captured press. -> why it ends, or ''. Guard: e2e/test/row-end.test.mjs.
const COLD_GRACE_MS = 15000, PRESS_GRACE_FACTOR = 3;

export function mayEnd({quietMs, stillMs, followed, livePresses, firstMissMs, nowMs}) {
  if (firstMissMs != null && nowMs - firstMissMs >= COLD_GRACE_MS) return 'cold ask';
  if (quietMs < stillMs) return '';
  if (followed >= livePresses) return 'still';
  return quietMs >= stillMs * PRESS_GRACE_FACTOR ? 'still, presses not made' : '';
}
