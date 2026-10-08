// The tailored-CV half of the apply suite (6 Oct 2026, split for the 7-minute budget): Tailor CV on a job, the form panel's tailored CV, Tailor CVs for top
// matches, and Apply on a saved job without a kit, plus (8 Oct 2026) the journeys across pages and tabs. Same setup and steps as suites/apply.mjs (runApply), its own Notion page (E2E_NOTION_TOKEN_APPLYCV).
import {runApply, stepNeeds as applyNeeds} from './apply.mjs';

export const stepNeeds = applyNeeds;   // what a step needs when E2E_STEPS picks it (lib/runner.mjs wantedWords)

export const varies = true;
export const minutes = 12;
export const browser = true;
export const engine = 'api';   // the proxy answers the app's AI calls (the CV, the tailoring)
export const macos = true;   // runs on a macOS runner: the real Chrome extension attaches the tailored CV (lib/plan.mjs runnerOf)
export const name = 'applycv';
export const run = ctx => runApply(ctx, ['cv', 'flows']);   // the journeys (docs/flows/applying.md) run here in CI: suites/applyflows.mjs is the same steps for the local matrix
