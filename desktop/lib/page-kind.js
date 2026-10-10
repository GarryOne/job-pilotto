// What kind of page is this, in an application's journey? One import path for the two rungs that answer it: rung 1, the kept answer per page shape (ladder/rung1-kept.js), and rung 2, the text sketch to
// the small model (ladder/rung2-sketch.js). Nothing lives here: the importers keep this path; a new importer should name the rung it needs. Guard: desktop/test/page-kind.test.js.
export * from './ladder/rung1-kept.js';
export * from './ladder/rung2-sketch.js';
