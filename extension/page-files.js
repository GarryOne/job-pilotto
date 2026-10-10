// The page scripts the extension injects into an application form (main world), in order: one list for flow.js, fill-flow.js and the tests.
// The form filler is FILL_FILES: its helpers by concern, then fill.js, which calls them (window.__jobPilottoFillKit). Guarded by
// worker/test/page-propose.test.js (order) and the tests that load the filler (aliases, fill-categories, extension-files, fill-learning).
export const FILL_FILES = ['page/fill-labels.js', 'page/fill-read.js', 'page/fill-menus.js', 'page/fill-checks.js', 'page/fill-marks.js', 'page/fill.js'];
export const PAGE_FILES = ['page/browser-submit-guard.js', 'page/browser-form-fastpath.js', 'page/snapshot.js', 'page/skeleton.js', 'page/controls.js',
  'page/required-mark.js', 'page/coverage.js', 'page/propose.js', 'page/upload.js', 'page/categories.js', 'page/dial-codes.js', 'page/radios.js', 'ladder/rung3-frames.js', 'page/menu-pick.js', 'ladder/rung3-candidates.js', ...FILL_FILES];
