// node pool-proof-pick.mjs <commit messages file>: which public pool row a PR's live proof runs (.github/workflows/pool-proof.yml, lib/pool-proof.mjs).
// The file holds one JSON string per line (gh api ... --jq '.[].commit.message | @json'); the PR comes from PR_ACTION, PR_LABEL, PR_LABELS (a JSON list), PR_BODY,
// PR_FORK. Writes row= and note= to $GITHUB_OUTPUT and the note to $GITHUB_STEP_SUMMARY; never fails the job (a neutral line is the answer).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pickProofRow} from './lib/pool-proof.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = (() => { try { return fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean); } catch { return []; } })();
const messages = lines.map(line => { try { return JSON.parse(line); } catch { return line; } });
const labels = (() => { try { return JSON.parse(process.env.PR_LABELS || '[]'); } catch { return []; } })();
const publicNames = JSON.parse(fs.readFileSync(path.join(here, 'smoke-sites.json'), 'utf8')).shapes.map(item => item.shape);
const {row, note} = pickProofRow({action: process.env.PR_ACTION || '', label: process.env.PR_LABEL || '', labels, body: process.env.PR_BODY || '', messages, publicNames, fork: process.env.PR_FORK === 'true'});
const oneLine = text => String(text).replace(/[\r\n]+/g, ' ');
console.log(`pool-proof: ${row ? `row "${row}"` : 'no run'}${note ? `: ${note}` : ''}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `row=${oneLine(row)}\nnote=${oneLine(note)}\n`);
if (process.env.GITHUB_STEP_SUMMARY && note) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Live proof\n\n${note}\n`);
