// The Notion part of the failure checks: a Jobs check while Notion is busy, answers an HTML error page, or is gone; a Save that Notion refuses. Its own Notion page, in parallel
// with activityfailures (the AI) and failureschannels (Telegram, Gmail, Google): the three halve the wall-clock time of the old single suite.
import {runParts} from './activityfailures.mjs';

export const minutes = 12;
export const name = 'failuresnotion';
export const keepGoing = true;
export const notionProxy = true;
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};
export const run = ctx => runParts(ctx, ['notion']);
