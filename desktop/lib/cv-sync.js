// Main process: the CV (once per version) and the approved cover letter to the Notion Profile; failures are logged, never block. Moved out of main.js; guarded by files.test.js.
import * as files from './files.js';
import * as letters from './cover-letter.js';
import {log as appLog} from './log.js';

// The CV in Notion (once per version) and the weekly backup of Mac-only files: failures are logged, never block.
export function createCvSync({DEMO, getStorage}) {
  return function syncCv() {
    if (DEMO) return;
    const storage = getStorage();
    files.syncCv(storage).then(done => done.uploaded && console.log(`CV saved to your Notion Profile (${done.uploaded})`))
      .catch(error => console.error(`CV not saved to Notion: ${error.message}`));
    // The approved cover letter too, once per version (lib/files.js): one approved with the data on this Mac reaches Notion after a move.
    files.coverLetterToProfile(storage, letters.pdfPath(storage)).then(caption => caption && appLog('cover-letter', 'PDF saved to the Notion Profile', {caption}))   // about Notion
      .catch(error => appLog('cover-letter', 'PDF not saved to Notion', {error: error.message}));   // about Notion
  };
}
