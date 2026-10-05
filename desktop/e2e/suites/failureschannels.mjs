// The channel part of the failure checks: the Telegram digest and a bot that refuses it, the Gmail check through a fake Google, and a revoked Google sign-in. Its own Notion page, in
// parallel with activityfailures (the AI) and failuresnotion.
import {runParts} from './activityfailures.mjs';

export const minutes = 12;
export const name = 'failureschannels';
export const keepGoing = true;
export const notionProxy = true;   // the Jobs check behind the Telegram digest writes to Notion
export const telegram = true;
export const google = true;
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};
export const run = ctx => runParts(ctx, ['channels']);
