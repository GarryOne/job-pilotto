// Every admin page's headline numbers, by path: a loader (env, now) -> tiles, drawn by src/section-overview.js on its section's Overview. A page in a section with an Overview
// that has no entry here fails test/section-overview.test.js. Loaders live in headlines-<section>.js (one concern each).
import {OPERATIONS} from './headlines-ops.js';
import {FORM_FILLING} from './headlines-form.js';
import {GROWTH, INTELLIGENCE} from './headlines-growth.js';
import {JOB_SEARCH} from './headlines-search.js';

export const HEADLINES = {...OPERATIONS, ...FORM_FILLING, ...GROWTH, ...JOB_SEARCH, ...INTELLIGENCE};
