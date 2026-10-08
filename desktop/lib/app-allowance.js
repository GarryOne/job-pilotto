// The free allowance, the health line and visit scoring (moved out of main.js, 8 Oct 2026): where the user stands (the license state), the guard before new work starts,
// scoring the jobs read in Chrome now, and the once-a-day health line with anonymous counts. The license, storage and telemetry are reached through getters.
// Guards: the license, health-line and visit-scoring tests in desktop/test.
import * as claudeCode from './claude-code.js';
import * as pipeline from './pipeline.js';
import * as terminals from './terminals.js';
import * as viewCache from './view-cache.js';
import {log as appLog} from './log.js';

export function createAppAllowance(ctx) {
  const {DEMO, getLicense, log, getStorage, getTelemetry, toWindow} = ctx;
  const HEALTH_VERSION = 5;  // bump when the daily health line gets new fields (2: outcome counts, 3: runsOk/runsFailed, 4: allowance, 5: licenseId)
  // Where the user stands (demo mode: a fixed fictional state for screenshots).
  const licenseState = () => (DEMO ? {licensed: false, license: null, keyProblem: '', used: 12, limit: 40, daysLeft: 41, ended: false} : getLicense().state());
  // Guard for what starts NEW work (Prepare kit, Fill in Chrome / Apply with Claude, manual searches): once the free allowance
  // is over and there is no key, the window says so and the action answers with why. Never used for what is already under way.
  function allowanceBlock() {
    const over = DEMO ? null : getLicense().blocked();
    if (!over) return null;
    toWindow('allowance', over);
    return {ok: false, allowance: true, error: 'The free allowance is over. Paste a license key in Settings → License to keep starting new applications.'};
  }
  // Jobs read in Chrome that match the search are scored now, by a search started at once (owner, 7 Oct 2026: "Read 5 jobs, but my Jobs count
  // never grows": they waited for the next scheduled check). Pages read in Chrome stay on this Mac, so with Always on they wait for a local search.
  const readSites = new Map();   // Read with Claude session id -> the addresses it reads
  function scoreVisitJobs(fits, by) {
    if (!fits || allowanceBlock()) return;
    // A light run that reads only the pages read in Chrome (src/daily.py --only-visits), first in the queue: about a minute, not a full search
    // behind a long Find new employers (owner, 7 Oct 2026: "why is Find new employers needed?"). With Always on too: those pages stay on this Mac.
    appLog('visit', 'scoring the jobs read in Chrome now, first in the queue', {fits, by});
    pipeline.scoreVisits(getStorage(), log);
  }
  // Once a day: version, OS, which features are on (never keys), a few counts, so reports can be read in context.
  function healthOnce() {
    // Once a day, and again the same day when the line's content changed (HEALTH_VERSION), so new counts arrive at once.
    const settings = getStorage().settings(), today = `${new Date().toISOString().slice(0, 10)}|${HEALTH_VERSION}`;
    if (!getTelemetry()?.enabled() || settings.telemetryHealthAt === today) return;
    getStorage().saveSettings({telemetryHealthAt: today});
    const has = name => !!getStorage().secret(name);
    getTelemetry().record('health', {ai: has('ANTHROPIC_API_KEY'), aiEngine: claudeCode.engine(settings, has('ANTHROPIC_API_KEY')) || 'none', notion: has('NOTION_TOKEN'), telegram: has('TELEGRAM_BOT_TOKEN'),
      serpapi: has('SERPAPI_API_KEY'), alwaysOn: !!settings.cloud?.repo, theme: settings.theme || 'light',
      sessions: terminals.list().length, runsKept: pipeline.runs(getStorage()).length, ...outcomes(settings), ...allowanceHealth(), ...getTelemetry().takeRuns()});
  }
  // The allowance on the health line, to measure it: licensed or not, the license kind and its random id (never the
  // name: only the owner can map an id to a person, in his private Notion 🔑 Licenses via tools/license.py sync),
  // applications used, days left, and whether the free allowance has ended.
  function allowanceHealth() {
    const state = licenseState();
    return {licensed: state.licensed, licenseKind: state.license?.kind || 'none', licenseId: state.license?.id || '', applicationsUsed: state.used, freeDaysLeft: state.daysLeft, allowanceEnded: state.ended};
  }
  // How much Job Pilotto helped, as anonymous counts (no company, no job title): open matches and good fits, forms the
  // extension filled, and the funnel (ever reached: applied, a human reply, screening, interviews, offers). From the
  // last Jobs and Focus reads (lib/view-cache.js), so nothing extra is read from Notion.
  function outcomes(settings) {
    const jobs = viewCache.recall(getStorage(), 'jobs')?.result?.jobs || [];
    const steps = viewCache.recall(getStorage(), 'focus')?.result?.focus?.funnel?.steps || [];
    const reached = name => steps.find(step => step.step.includes(name))?.reached ?? null;
    return {matches: jobs.length, goodFits: jobs.filter(job => job.fit >= 70).length, formsFilled: settings.formsFilled || 0,
      prepared: reached('Prepared'), applied: reached('Applied'), replies: reached('Human reply'), screenings: reached('Screening'),
      interviews: reached('Interviews'), offers: reached('Offer')};
  }
  return {licenseState, allowanceBlock, readSites, scoreVisitJobs, healthOnce};
}
