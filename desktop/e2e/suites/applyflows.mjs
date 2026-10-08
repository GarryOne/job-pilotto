// The journeys half of the apply suite, for the LOCAL scenario matrix (npm run flows; 8 Oct 2026): a posting whose Apply opens a new tab, two applications side by
// side, a sign-up before the form, the account and the application on one page, a closed form tab, a wrong page kind, "I submitted it". The same steps as suites/apply.mjs
// (runApply), on its own Notion page and token (E2E_NOTION_TOKEN_APPLYFLOWS, Keychain job-pilotto.e2e.notion_token_applyflows), so it runs in parallel with `apply`.
// CI does not schedule it: GitHub's Free plan allows 5 macOS jobs and this needs the Mac (`open` to Chrome, the Keychain), so CI runs these steps inside applycv.
import {runApply, stepNeeds as applyNeeds} from './apply.mjs';

export const stepNeeds = applyNeeds;   // what a step needs when E2E_STEPS picks it (lib/runner.mjs wantedWords)

export const varies = true;
export const minutes = 12;
export const budgetMinutes = 10;   // a manual suite may ask for more than 7: its first run builds the workspace once with the wizard's path
export const cadence = 'manual';   // never chosen by a push or a schedule (lib/plan.mjs); the scenario matrix names it
export const browser = true;
export const engine = 'api';   // the proxy answers the app's AI calls (the page kinds, the open question)
export const name = 'applyflows';
export const run = ctx => runApply(ctx, process.env.LIVE ? ['live'] : ['flows']);   // LIVE=1: the live run on a real posting (npm run live), not the matrix
