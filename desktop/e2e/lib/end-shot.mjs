// The run's last picture of the application tab (11 Oct 2026): <capture dir>/end.png, taken by the live row (lib/live-row.mjs) and the Electron live run (lib/apply-live.mjs) BEFORE their final privacy check,
// so a tripwire hit deletes it with the capture folder (a plan-path model may type real details into a form; a picture keeps them where no text scan looks). Fake applicant only, local, never uploaded.
import path from 'node:path';
import {fullPageShot} from './step-shots.mjs';
import {cookieLayerLeft} from './cookie-layer-left.mjs';

// One tab into one file (a replay's row tab: lib/row-replay.mjs). -> {file, why}
export async function shotTab(tab, file) {
  const shot = await fullPageShot(tab, file);   // the whole page (lib/step-shots.mjs), a cap says "cut at <n> px"
  return shot.file ? {file: shot.file, why: shot.why} : {file: '', why: shot.why};
}

// -> {file, why}: the picture, or '' and the reason in words (the run says it out loud: "no end screenshot: <why>", an error in its verdict; owner, 11 Oct 2026: the picture is a must).
export async function takeEndShot(context, captureDir) {
  if (!captureDir) return {file: '', why: 'no capture folder'};
  const tab = context.pages().filter(page => /^https?:/.test(page.url())).at(-1);
  if (!tab) return {file: '', why: 'no page tab was open'};
  const shot = await shotTab(tab, path.join(captureDir, 'end.png'));
  // The end check: a cookie layer still open is a miss, never "clean" (Fidag, 11 Oct 2026). A fixed overlay that speaks of cookies (lib/cookie-layer-left.mjs).
  const layer = await Promise.resolve().then(() => tab.evaluate(cookieLayerLeft)).catch(() => []);
  return Array.isArray(layer) && layer.length ? {...shot, layer} : shot;
}

// What the run prints about it (lib/smoke.mjs parseLive turns the second form into an error).
export const endShotLine = shot => (shot.file ? `live: end screenshot kept${shot.why ? ` (${shot.why})` : ''}` : `live: no end screenshot: ${shot.why}`)
  + (shot.layer?.length ? `\n  live: cookie layer still open at the end: ${shot.layer.slice(0, 4).join(' | ').slice(0, 100)}` : '');   // lib/smoke.mjs parseLive turns it into an error
