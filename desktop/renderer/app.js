// The window: setup wizard on first run, then Focus, Jobs, Strategy, sessions and Settings, one module per page
// (pages/). It only talks to the app through window.pilot (preload.cjs); it never sees a key's value.
// Each page's start-up code runs here in the order it always has.
import {init as core} from './pages/core.js';
import {init as wizard} from './pages/wizard.js';
import {init as activity} from './pages/activity.js';
import {init as strategyReview} from './pages/strategy-review.js';
import {init as settings} from './pages/settings.js';
import {init as nav} from './pages/nav.js';
import {init as jobs} from './pages/jobs.js';
import {init as strategy} from './pages/strategy.js';
import {init as profile} from './pages/profile.js';
import {init as connections} from './pages/connections.js';
import {init as actions} from './pages/actions.js';
import {init as cvChange} from './pages/cv-change.js';
import {init as data} from './pages/data.js';
import {init as startup} from './pages/startup.js';
import {init as interviews} from './pages/interviews.js';
import {init as focus} from './pages/focus.js';
import {init as sessions} from './pages/sessions.js';
import {init as sessionNeeds} from './pages/session-needs.js';
import {init as sessionLog} from './pages/session-log.js';
import {init as runsPage} from './pages/runs-page.js';

await core();
await wizard();
await activity();
await strategyReview();
await settings();
await nav();
await jobs();
await strategy();
await profile();
await connections();
await actions();
await cvChange();
await data();
await startup();
await interviews();
await focus();
await sessions();
await sessionNeeds();
await sessionLog();
await runsPage();
