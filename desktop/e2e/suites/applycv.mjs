// The journeys half of the apply suite in CI (docs/flows/applying.md): pages and tabs, account steps, menus, upload slots, a wrong page kind. Until 9 Oct 2026 it also held
// the tailored-CV steps; with the journeys it ran over the 7-minute budget (394 s of steps on Windows), so they moved to suites/apply.mjs (macOS too). Name kept: its Notion page and token. Same setup and steps as suites/apply.mjs (runApply), its own Notion page (E2E_NOTION_TOKEN_APPLYCV).
import {runApply, stepNeeds as applyNeeds} from './apply.mjs';

export const stepNeeds = applyNeeds;   // what a step needs when E2E_STEPS picks it (lib/runner.mjs wantedWords)

export const varies = true;
export const minutes = 12;
export const browser = true;
export const engine = 'api';   // the proxy answers the app's AI calls (the CV, the tailoring)
export const macos = true;   // runs on a macOS runner: the real Chrome extension attaches the tailored CV (lib/plan.mjs runnerOf)
export const name = 'applycv';
export const run = ctx => runApply(ctx, ['flows']);   // the journeys (docs/flows/applying.md) run here in CI: suites/applyflows.mjs is the same steps for the local matrix
