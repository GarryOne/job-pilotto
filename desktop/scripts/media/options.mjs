// The media command's pure parts (desktop/scripts/media): its arguments, the persona (a demo-data folder, refused if it holds a real key), the AI
// director's plan over a scene, a frame's size. Kept apart from the recorders so tests load them without a browser. Guard: desktop/test/media-options.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {realSecrets} from './check.mjs';
import {DEFAULT_PERSONA, VIDEOS} from './scenes.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

export function parseArgs(argv) {
  const options = {pieces: [], out: path.join(os.tmpdir(), 'jobadabra-media'), persona: path.join(here, 'personas', 'nurse-lyon'), keep: false};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') options.out = path.resolve(argv[++i]);
    else if (argv[i] === '--persona') options.persona = path.resolve(argv[++i]);
    else if (argv[i] === '--keep') options.keep = true;
    else options.pieces.push(argv[i]);
  }
  const known = [...Object.keys(VIDEOS), 'stills', 'snips'];
  const unknown = options.pieces.filter(piece => !known.includes(piece));
  if (unknown.length) throw new Error(`media: unknown piece ${unknown.join(', ')} (known: ${known.join(', ')})`);
  if (!options.pieces.length) options.pieces = known;
  return options;
}

// The persona: its data folder (refused if it holds a real key) and its media.json over the defaults: who applies, the form's job, the day its
// dates are written around (today), its time zone, and the default person's words that must not show (forbid).
export function loadPersona(folder) {
  if (!fs.existsSync(path.join(folder, 'profile.md'))) throw new Error(`media: ${folder} is not a persona folder (no profile.md; copy desktop/demo)`);
  const secrets = fs.existsSync(path.join(folder, 'secrets.json')) ? JSON.parse(fs.readFileSync(path.join(folder, 'secrets.json'), 'utf8')) : {};
  const real = realSecrets(secrets);
  if (real.length) throw new Error(`media: ${folder} holds real-looking keys (${real.join(', ')}): media use fictional data only`);
  const own = fs.existsSync(path.join(folder, 'media.json')) ? JSON.parse(fs.readFileSync(path.join(folder, 'media.json'), 'utf8')) : {};
  return {folder, name: own.name || path.basename(folder), applicant: {...DEFAULT_PERSONA.applicant, ...own.applicant},
    answers: {...DEFAULT_PERSONA.answers, ...own.answers}, job: {...DEFAULT_PERSONA.job, ...own.job},
    today: own.today || '', tz: own.tz || 'Europe/Zurich', forbid: Array.isArray(own.forbid) ? own.forbid : []};
}

// The director's plan (plans/<piece>.json, direct.mjs) over the scene: a zoom per look, the manifest's words.
export function withPlan(piece, plan) {
  if (!plan) return piece;
  const steps = piece.steps.map(step => (step.look && plan.zooms?.[step.look] != null ? {...step, zoom: plan.zooms[step.look]} : step));
  return {...piece, steps, caption: plan.caption || piece.caption, shows: plan.shows || piece.shows, alt: plan.alt || piece.alt};
}
export const planOf = (name, dir = path.join(here, 'plans')) => { const file = path.join(dir, `${name}.json`); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; };

// A JPEG's pixel width, from its SOF marker (the screencast's frames are 2x the page). Pure.
export function jpegWidth(buffer) {
  for (let i = 2; i + 8 < buffer.length;) {
    if (buffer[i] !== 0xff) { i++; continue; }
    const marker = buffer[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return buffer.readUInt16BE(i + 7);
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  throw new Error('media: not a JPEG frame');
}

