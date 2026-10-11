// Setting the CV and reading it once: every path that picks a CV goes through setCv, which puts the file in place and, in the
// background, imports it into cv/cv.json (the facts the form AI, Tailor and the match read). The same file is never read twice
// (cv/import.json holds the hash of the PDF cv.json came from); a failure is logged and toasted, never blocks the upload; Tailor
// and the cover letter call ensure() too, so a missed import is retried there and two imports at once share one call.
// Guarded by test/cv-import-at-upload.test.js (it also fails when a new caller bypasses these functions).
import * as cvChange from './cv-change.js';
import * as cvlib from './cv.js';
import fs from 'node:fs';
import {log} from './log.js';

const inflight = new Map();   // the CV folder -> the running import

// -> {skipped} | {cv, usd}. force: the explicit "import again". atUpload: a new file was just set, so a cv.json of unknown origin is not trusted.
export function ensure(storage, {client = null, key = '', look = null, force = false, atUpload = false} = {}) {
  if (!fs.existsSync(storage.path('cv.pdf'))) return Promise.resolve({skipped: 'no CV'});
  const folder = cvlib.dir(storage);
  if (inflight.has(folder)) return inflight.get(folder);
  const from = cvlib.importedFrom(storage);
  if (!force && cvlib.baseCv(storage) && (from ? from === cvlib.pdfHash(storage) : !atUpload)) return Promise.resolve({skipped: 'already imported'});
  const run = cvlib.importPdf(storage, key, client, {look}).finally(() => inflight.delete(folder));
  inflight.set(folder, run);
  return run;
}

// The CV picked by the person (Settings, onboarding, Activity and the Actions card all call chooseCv). -> {name, review, done}: the upload is
// finished when this returns; done settles when the background import has (it never rejects).
export function setCv(storage, file, name, {client = null, key = '', look = null, toast = () => {}, now = new Date()} = {}) {
  const set = cvChange.replace(storage, file, name, now);
  const state = (value, extra = {}) => storage.saveSettings({cvImport: {state: value, at: new Date().toISOString(), ...extra}});
  if (!client && !key) { state('waiting-for-ai'); return {...set, done: Promise.resolve()}; }
  state('running');
  const done = ensure(storage, {client, key, look, atUpload: true}).then(result => {
    state('done');
    log('cv', 'CV read at upload', result.skipped ? {skipped: result.skipped} : {usd: result.usd});
  }).catch(error => {
    const message = String(error?.message || error).slice(0, 200);
    state('failed', {error: message});
    log('cv', 'CV not read at upload', {error: message});
    toast({title: 'CV not read yet', body: 'Your CV is saved. It will be read again when you tailor a CV.'});
  });
  return {...set, done};
}
