// The run's last picture of the application tab (11 Oct 2026): <capture dir>/end.png, taken by the live row (lib/live-row.mjs) and the Electron live run (lib/apply-live.mjs) BEFORE their final privacy check,
// so a tripwire hit deletes it with the capture folder (a plan-path model may type real details into a form; a picture keeps them where no text scan looks). Fake applicant only, local, never uploaded.
import fs from 'node:fs';
import path from 'node:path';

// -> the file, or '' when there is no http tab or no folder.
export async function takeEndShot(context, captureDir) {
  const tab = context.pages().filter(page => /^https?:/.test(page.url())).at(-1);
  if (!tab || !captureDir) return '';
  fs.mkdirSync(captureDir, {recursive: true});
  const file = path.join(captureDir, 'end.png');
  await tab.screenshot({path: file}).catch(() => {});
  return fs.existsSync(file) ? file : '';
}
