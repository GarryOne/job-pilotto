// node pool-proven.mjs <smoke reports folder> [commit subjects file]: after a CI pool run, send one "proven live" record per row that really ran (lib/pool-proven.mjs ->
// lib/applying-report.mjs uploadProven, the narrow REPLAYS_PUBLISH_KEY). Context from the workflow: GITHUB_RUN_ID, GITHUB_REF_NAME, PR_NUMBER, PR_HEAD_SHA, GITHUB_SHA.
// The subjects file holds one JSON string per line (the PR's commit subjects). Never fails the job: it prints one line.
import fs from 'node:fs';
import path from 'node:path';
import {uploadProven} from './lib/applying-report.mjs';
import {recordsOf} from './lib/pool-proven.mjs';

const [dir = '', subjectsFile = ''] = process.argv.slice(2), env = process.env;
const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
const report = days.length ? JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')) : {};
const subjects = (() => { try { return fs.readFileSync(subjectsFile, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return line; } }); } catch { return []; } })();
const pr = Number(env.PR_NUMBER) > 0 ? Number(env.PR_NUMBER) : null;
const records = recordsOf(report, {run: env.GITHUB_RUN_ID, branch: pr ? (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME) : env.GITHUB_REF_NAME, pr, sha: pr ? env.PR_HEAD_SHA : env.GITHUB_SHA, subjects, at: new Date().toISOString()});
console.log(await uploadProven(records, {env}));
