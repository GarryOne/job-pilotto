// node pool-endings.mjs <smoke reports folder>: after a CI pool run, send each row's ending (lib/pool-endings.mjs) to /applying/endings with the narrow key. Context from the
// workflow: GITHUB_RUN_ID, GITHUB_REF_NAME (or GITHUB_HEAD_REF on a PR), PR_HEAD_SHA or GITHUB_SHA. Never fails the job: it prints one line.
import fs from 'node:fs';
import path from 'node:path';
import {endingRecords, uploadEndings} from './lib/pool-endings.mjs';

const [dir = ''] = process.argv.slice(2), env = process.env;
const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
const report = days.length ? JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')) : {};
const pr = Number(env.PR_NUMBER) > 0;
const records = endingRecords(report, {run: env.GITHUB_RUN_ID, branch: pr ? (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME) : env.GITHUB_REF_NAME, sha: pr ? env.PR_HEAD_SHA : env.GITHUB_SHA, at: new Date().toISOString()});
console.log(await uploadEndings(records, {env}));
