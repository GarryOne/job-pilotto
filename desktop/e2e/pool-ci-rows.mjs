// node pool-ci-rows.mjs <smoke reports folder>: after a CI recording run on main, send each row this run ran to /applying/ci-rows (lib/pool-ci-rows.mjs). Context from the workflow:
// GITHUB_REF_NAME, and the day report's own day and the build's version. Never fails the job: it prints one line.
import fs from 'node:fs';
import path from 'node:path';
import {extensionVersion} from './lib/applying-report.mjs';
import {ciRows, uploadCiRows} from './lib/pool-ci-rows.mjs';
import {uploadFillVideo} from './lib/lab-video-upload.mjs';

const [dir = ''] = process.argv.slice(2), env = process.env;
const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
const report = days.length ? JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')) : {};
console.log(await uploadCiRows(ciRows(report), {branch: env.GITHUB_REF_NAME, day: days.length ? days.at(-1).slice(0, 10) : '', version: extensionVersion()}, {env}));
// The rows' fill videos for the Lab's ▶ Watch (lib/lab-video-upload.mjs): one PUT each, same guards; a row without a video says nothing.
for (const [name, item] of Object.entries(report.results || {})) if (item?.video && (!Array.isArray(report.thisRun?.ran) || report.thisRun.ran.includes(name))) console.log(await uploadFillVideo(name, item.video, {branch: env.GITHUB_REF_NAME}, {env}));
