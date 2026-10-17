// A tab the person picked wins over a default that arrives late (17 Oct 2026: opening Settings → Profile awaits the app state, then showed "CV & details";
// a click on Preferences made in between was undone). Every pick counts: `const stillDefault = startDefault()` before waiting, `stillDefault()` after.
// No DOM: guarded by test/tab-choice.test.js.
let picks = 0;
export const pick = () => { picks++; };
export const startDefault = () => { const seen = picks; return () => picks === seen; };
