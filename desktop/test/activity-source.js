// The source text of the Recent activity page: pages/activity.js and the activity-*.js pieces it was split into (a pure move),
// for the tests that check the page's code by reading it. Used by the tests that read activity.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const pages = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/pages');
export const activityFiles = () => fs.readdirSync(pages).filter(name => /^activity(-[\w-]+)?\.js$/.test(name)).sort();
export const activitySource = () => activityFiles().map(name => fs.readFileSync(path.join(pages, name), 'utf8')).join('\n');
