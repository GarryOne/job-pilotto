// Every admin page's headline numbers, by path: a loader (env, now) -> tiles, drawn by src/section-overview.js on its section's Overview. A page in a section with an Overview
// that has no entry here fails test/section-overview.test.js. Loaders live in headlines-<section>.js (one concern each).
import {OPERATIONS} from './headlines-ops.js';

export const HEADLINES = {...OPERATIONS};
