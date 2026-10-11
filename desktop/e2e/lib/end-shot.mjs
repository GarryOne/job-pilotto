// The run's last picture of the application tab (11 Oct 2026): <capture dir>/end.png, taken by the live row (lib/live-row.mjs) and the Electron live run (lib/apply-live.mjs) BEFORE their final privacy check,
// so a tripwire hit deletes it with the capture folder (a plan-path model may type real details into a form; a picture keeps them where no text scan looks). Fake applicant only, local, never uploaded.
import fs from 'node:fs';
import path from 'node:path';

// -> {file, why}: the picture, or '' and the reason in words (the run says it out loud: "no end screenshot: <why>", an error in its verdict; owner, 11 Oct 2026: the picture is a must).
export async function takeEndShot(context, captureDir) {
  if (!captureDir) return {file: '', why: 'no capture folder'};
  const tab = context.pages().filter(page => /^https?:/.test(page.url())).at(-1);
  if (!tab) return {file: '', why: 'no page tab was open'};
  const file = path.join(captureDir, 'end.png');
  try { fs.mkdirSync(captureDir, {recursive: true}); await tab.screenshot({path: file}); } catch (error) { return {file: '', why: `the screenshot failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 80)}`}; }
  return fs.existsSync(file) && fs.statSync(file).size > 0 ? {file, why: ''} : {file: '', why: 'the screenshot file is empty'};
}

// What the run prints about it (lib/smoke.mjs parseLive turns the second form into an error).
export const endShotLine = shot => (shot.file ? 'live: end screenshot kept' : `live: no end screenshot: ${shot.why}`);
