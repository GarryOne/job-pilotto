// node pool-proof-pick.mjs <commit messages file>: which public pool row a PR's live proof runs (.github/workflows/pool-proof.yml, lib/pool-proof.mjs).
// The file holds one JSON string per line (gh api ... --jq '.[].commit.message | @json'); the PR comes from PR_ACTION, PR_LABEL, PR_LABELS (a JSON list), PR_BODY,
// PR_FORK. Writes row= and note= to $GITHUB_OUTPUT and the note to $GITHUB_STEP_SUMMARY; never fails the job (a neutral line is the answer).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pickProofRow, proofApplicant} from './lib/pool-proof.mjs';
import {planProof, rowUrl} from './lib/pool-proof-visit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = (() => { try { return fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean); } catch { return []; } })();
const messages = lines.map(line => { try { return JSON.parse(line); } catch { return line; } });
const labels = (() => { try { return JSON.parse(process.env.PR_LABELS || '[]'); } catch { return []; } })();
const sites = JSON.parse(fs.readFileSync(path.join(here, 'smoke-sites.json'), 'utf8')), publicNames = sites.shapes.map(item => item.shape);
const picked = pickProofRow({action: process.env.PR_ACTION || '', label: process.env.PR_LABEL || '', labels, body: process.env.PR_BODY || '', messages, publicNames, fork: process.env.PR_FORK === 'true'});
// The row's site cannot be visited today (CI's ledger, prepared by the workflow as the run prepares it): no row, so the proof job is SKIPPED and the NOT RUN line goes to the PR
// as a comment (owner, 12 Oct 2026: every PR check required; a reason outside the PR never blocks a merge). Without a prepared ledger the run decides, as before.
const plan = picked.row && process.env.JOB_PILOTTO_SITE_LEDGER_DIR ? planProof({row: picked.row, url: rowUrl(picked.row, sites)}) : {row: picked.row, skipped: ''};
const {row} = plan, note = plan.skipped || picked.note;
const oneLine = text => String(text).replace(/[\r\n]+/g, ' '), applicant = proofApplicant(process.env.PR_BODY);
console.log(`pool-proof: ${row ? `row "${row}" as the ${applicant} applicant` : 'no run'}${note ? `: ${note}` : ''}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `row=${oneLine(row)}\nnote=${oneLine(note)}\napplicant=${applicant}\nskipped=${oneLine(plan.skipped)}\n`);
if (process.env.GITHUB_STEP_SUMMARY && note && process.env.JP_PICK_QUIET !== '1') fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Live proof\n\n${note}${row ? ` (the ${applicant} applicant)` : ''}\n`);
