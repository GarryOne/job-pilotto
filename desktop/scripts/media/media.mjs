// The product's screenshots and videos, made with nobody's hands (owner, 20 Oct 2026): records the app (demo mode, dark) and the real extension on a
// fictional form, adds zooms, cursor and clicks in code from the click log, checks every piece, writes the site's files + manifest.json.
//   npm run media                                   all pieces → <tmp>/jobadabra-media
//   npm run media -- hero stills --out <dir>        some pieces (hero, extension-fill, stills, snips); a partial run keeps the others in manifest.json
//   npm run media -- --persona <folder>             another search profile (default: personas/nurse-lyon): files laid over desktop/demo + media.json
//   npm run media -- --keep                         keep the frames and logs (<out>/.work) for the director (direct.mjs) or a look
// Zooms and captions the AI director chose are in plans/<piece>.json (direct.mjs); without one, the camera frames each hold's `look`.
// CI: .github/workflows/product-media.yml runs it on main after a screen, extension or demo change. Guards: desktop/test/media-*.test.js.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {posterTime, renderPlan, RING} from './camera.mjs';
import {leftWords, pieceProblems, realEmails} from './check.mjs';
import {brightness, duration, encodeStill, encodeVideo, missingEncoders} from './encode.mjs';
import {manifest, stillEntry, videoEntry} from './manifest.mjs';
import {recordAppVideo, shootApp} from './record-app.mjs';
import {recordExtensionVideo} from './record-extension.mjs';
import {jpegWidth, loadPersona, parseArgs, planOf, withPlan} from './options.mjs';
import {SNIPS, STILLS, VIDEOS} from './scenes.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const desktop = path.resolve(here, '..', '..');
const FPS = 30;

async function makeVideo(name, persona, work, out) {
  const piece = withPlan(VIDEOS[name], planOf(name));
  const stale = leftWords(`${piece.caption} ${piece.shows} ${piece.alt}`, persona.forbid);
  if (stale.length) throw new Error(`${name}: the plan's words name the default demo person (${stale.join(', ')}): run direct.mjs ${name} again`);
  const dir = path.join(work, name);
  fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
  const record = piece.source === 'extension' ? recordExtensionVideo : recordAppVideo;
  const log = await record({persona, piece, dir});
  console.log(`media: ${name}: recorded ${log.frames.length} frames, ${log.frames.at(-1).t.toFixed(1)} s`);
  const first = fs.readFileSync(path.join(dir, 'frames', log.frames[0].file));
  const scale = jpegWidth(first) / log.viewport.w;
  const job = {framesDir: path.join(dir, 'frames'), frames: renderPlan(log, FPS), scale, width: piece.width, height: piece.height, fps: FPS, ring: RING,
    out: path.join(dir, 'master.mp4'), ffmpeg: 'ffmpeg'};
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job));
  const run = spawnSync(path.join(desktop, 'node_modules', '.bin', 'electron'), [path.join(here, 'render.cjs'), path.join(dir, 'job.json')], {stdio: 'inherit', timeout: 15 * 60000});
  if (run.status !== 0) throw new Error(`media: ${name}: the renderer failed (${run.status ?? run.signal})`);
  const problems = pieceProblems({name, source: piece.source, log, posterBrightness: brightness(path.join(dir, 'frames', log.frames[0].file)), forbid: persona.forbid});
  if (problems.length) throw new Error(problems.join('\n'));
  const {files, bytes} = encodeVideo({master: job.out, name, piece, outDir: out, posterAt: posterTime(log.events)});
  console.log(`media: ${name}: ${Object.entries(bytes).map(([kind, n]) => `${kind} ${(n / 1e6).toFixed(2)} MB`).join(', ')}`);
  return videoEntry({name, piece, files, bytes, seconds: duration(path.join(out, files.mp4))});
}

async function makeStills(kinds, persona, work, out) {
  const dir = path.join(work, 'stills');
  fs.mkdirSync(dir, {recursive: true});
  const shots = await shootApp({persona, stills: kinds.includes('stills') ? STILLS : {}, snips: kinds.includes('snips') ? SNIPS : {}, dir});
  return shots.map(shot => {
    const emails = realEmails(shot.text);
    if (emails.length) throw new Error(`media: ${shot.kind} ${shot.name}: an e-mail address that may be real is on screen: ${emails.join(', ')}`);
    const left = leftWords(shot.text, persona.forbid);
    if (left.length) throw new Error(`media: ${shot.kind} ${shot.name}: the default demo person shows through: ${left.join(', ')}`);
    const encoded = encodeStill({png: shot.file, name: shot.name, kind: shot.kind, outDir: out});
    return stillEntry({name: shot.name, kind: shot.kind, ...encoded, shows: (shot.kind === 'still' ? STILLS : SNIPS)[shot.name].shows});
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const persona = loadPersona(options.persona);
  const missing = missingEncoders();
  if (missing.length) throw new Error(`this ffmpeg lacks ${missing.join(', ')} (brew install ffmpeg)`);
  const work = path.join(options.out, '.work');
  fs.mkdirSync(work, {recursive: true});
  execFileSync(process.execPath, [path.join(desktop, 'scripts', 'stage.mjs')], {cwd: desktop, stdio: 'ignore'});   // the app imports shared/ (npm start does the same)
  const entries = [];
  for (const name of options.pieces.filter(piece => VIDEOS[piece])) entries.push(await makeVideo(name, persona, work, options.out));
  const kinds = options.pieces.filter(piece => piece === 'stills' || piece === 'snips');
  if (kinds.length) entries.push(...await makeStills(kinds, persona, work, options.out));
  const file = path.join(options.out, 'manifest.json');
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: desktop, encoding: 'utf8'}).trim();
  fs.writeFileSync(file, `${JSON.stringify(manifest({entries, previous, made: {sha, at: new Date().toISOString(), persona: persona.name}}), null, 2)}\n`);
  if (!options.keep) fs.rmSync(work, {recursive: true, force: true});
  console.log(`media: DONE ${entries.length} piece(s) → ${options.out}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main().catch(error => { console.error(`media: FAILED ${error.message}`); process.exit(1); });
