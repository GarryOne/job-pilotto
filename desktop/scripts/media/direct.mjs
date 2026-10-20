// The AI director of the product videos (desktop/scripts/media): Claude looks at a recorded piece (its click log and one picture per hold) and
// chooses how far each hold zooms and the manifest's words. Saved as plans/<piece>.json, which every later render reuses, so CI never calls an AI:
// run it once per new or changed scene, on the Claude Code subscription (owner, 20 Oct 2026: "Code + Claude"; no API key, never in CI).
//   npm run media -- hero --keep && node scripts/media/direct.mjs hero          (--work <dir>: the .work folder of that run)
// Guard: desktop/test/media-direct.test.js (validatePlan).
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MAX_ZOOM} from './camera.mjs';
import {VIDEOS} from './scenes.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
export const MODEL = 'claude-sonnet-5-5';

// The director's answer, checked: a zoom per known look within 1..MAX_ZOOM, a caption of 6 words at most, plain words for shows/alt. Pure.
// -> {plan} or {error}
export function validatePlan(answer, looks) {
  let plan;
  try { plan = typeof answer === 'string' ? JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```\s*$/g, '')) : answer; } catch { return {error: 'not JSON'}; }
  if (!plan || typeof plan !== 'object') return {error: 'not an object'};
  const zooms = {};
  for (const [look, zoom] of Object.entries(plan.zooms || {})) {
    if (!looks.includes(look)) return {error: `unknown look ${look}`};
    if (typeof zoom !== 'number' || zoom < 1 || zoom > MAX_ZOOM) return {error: `zoom ${zoom} for ${look} is outside 1..${MAX_ZOOM}`};
    zooms[look] = Number(zoom.toFixed(2));
  }
  const words = (text, max) => typeof text === 'string' && text.trim().length > 0 && text.length <= max;
  if (!words(plan.caption, 80) || plan.caption.trim().split(/\s+/).length > 6) return {error: 'caption missing or over 6 words'};
  if (!words(plan.shows, 160)) return {error: 'shows missing or over 160 characters'};
  if (!words(plan.alt, 300)) return {error: 'alt missing or over 300 characters'};
  return {plan: {zooms, caption: plan.caption.trim(), shows: plan.shows.trim(), alt: plan.alt.trim()}};
}

export const prompt = (name, looks) => `You direct a short silent product video ("${name}") for Jobadabra, a job-search app, shown on its website to job seekers of every trade.
Read log.json in this folder (what the recorder did: clicks and holds; each hold's "look" is the part of the screen it is about, its "box" in page pixels),
and look at the pictures hold-1.jpg, hold-2.jpg, ... (the whole screen at the start of each hold that has a look).
Decide, for each look, how far the camera zooms onto it: 1 = stay on the whole screen, up to ${MAX_ZOOM} = close. Zoom where it helps a first-time viewer read the action;
stay wide where the whole screen tells more. Then write the site's words: a caption (at most 6 plain words, what the person gets, no UI names, any trade),
"shows" (one line under 160 characters: what is on screen) and "alt" (alt text for a blind reader, under 300 characters).
Looks: ${JSON.stringify(looks)}
Answer with ONLY this JSON, no prose: {"zooms": {"<look>": <number>}, "caption": "...", "shows": "...", "alt": "..."}`;

function direct(name, work) {
  const dir = path.join(work, name), log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const holds = log.events.filter(event => event.type === 'hold' && event.look);
  const looks = [...new Set(holds.map(hold => hold.look))];
  if (!looks.length) { console.log(`direct: ${name}: no hold with a look, nothing to direct`); return; }
  const desk = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-direct-'));
  fs.writeFileSync(path.join(desk, 'log.json'), JSON.stringify({viewport: log.viewport, events: log.events}, null, 1));
  holds.forEach((hold, i) => {
    const frame = log.frames.findLast(f => f.t <= hold.t + 0.2) || log.frames[0];
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, 'frames', frame.file), '-vf', 'scale=1200:-2', '-q:v', '4', path.join(desk, `hold-${i + 1}.jpg`)]);
  });
  const env = {...process.env};
  delete env.ANTHROPIC_API_KEY;   // the subscription, never an API key on this Mac
  // A refused answer is asked again once, with the reason; never kept as sure.
  let plan = null, error = '', cost = 0, said = '';
  for (let turn = 0; turn < 2 && !plan; turn++) {
    const ask = turn ? `${prompt(name, looks)}\nYour previous answer was refused (${error}): ${said.slice(0, 400)}\nAnswer again.` : prompt(name, looks);
    const run = spawnSync('claude', ['-p', ask, '--model', MODEL, '--output-format', 'json', '--allowedTools', 'Read'], {cwd: desk, env, encoding: 'utf8', timeout: 5 * 60000});
    if (run.status !== 0) { fs.rmSync(desk, {recursive: true, force: true}); throw new Error(`direct: ${name}: claude -p failed (${run.status}): ${(run.stderr || '').slice(-300)}`); }
    const reply = JSON.parse(run.stdout);
    cost += reply.total_cost_usd || 0; said = String(reply.result);
    ({plan, error} = validatePlan(reply.result, looks));
  }
  fs.rmSync(desk, {recursive: true, force: true});
  if (!plan) throw new Error(`direct: ${name}: the plan was refused twice (${error}): ${said.slice(0, 300)}`);
  const file = path.join(here, 'plans', `${name}.json`);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify({by: MODEL, at: new Date().toISOString().slice(0, 10), ...plan}, null, 2)}\n`);
  console.log(`direct: ${name}: ${JSON.stringify(plan.zooms)} "${plan.caption}" → ${path.relative(process.cwd(), file)} (list price $${cost.toFixed(3)}, on the subscription)`);
}

function main() {
  if (process.env.CI) throw new Error('direct: never in CI (no AI spend there): run it on a Mac, commit plans/<piece>.json');
  const args = process.argv.slice(2), at = args.indexOf('--work');
  const work = at >= 0 ? path.resolve(args.splice(at, 2)[1]) : path.join(os.tmpdir(), 'jobadabra-media', '.work');
  const names = args.length ? args : Object.keys(VIDEOS);
  for (const name of names) {
    if (!VIDEOS[name]) throw new Error(`direct: ${name} is not a video piece`);
    if (!fs.existsSync(path.join(work, name, 'log.json'))) throw new Error(`direct: no recording of ${name} in ${work} (run: npm run media -- ${name} --keep)`);
    direct(name, work);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) { try { main(); } catch (error) { console.error(error.message); process.exit(1); } }
