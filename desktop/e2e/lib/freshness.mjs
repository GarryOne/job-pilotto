// A finding made on a build older than main is held when the code it is about has changed since (5 Oct 2026: five of thirteen findings, #291, #292, #294, #295 and #297, were the same
// defects the loop's own fixes had already removed: the release gate tests a tag built hours before main). Whether a fix exists is not known by name; what is known is which files the
// finding is about and which files changed between the tested build and main. If one did, the page may already be different: the finding is not filed, it is counted ("held for
// recheck"), and the next run on a newer build sees it again if it is real. Pure; the compare API's file list comes from triage.mjs.
const PAGE_FILES = {
  activity: ['desktop/renderer/pages/activity.js', 'desktop/renderer/run-warnings.js', 'desktop/renderer/run-status.js', 'desktop/renderer/run-cards.js', 'desktop/lib/run-result.js', 'desktop/lib/pipeline.js', 'desktop/lib/run-history.js'],
  calendar: ['desktop/renderer/pages/calendar.js', 'desktop/renderer/calendar.js'],
  focus: ['desktop/renderer/pages/focus.js', 'desktop/renderer/funnel-view.js', 'desktop/lib/view-cache.js'],
  jobs: ['desktop/renderer/pages/jobs.js'],
  strategy: ['desktop/renderer/pages/strategy.js'],
  settings: ['desktop/renderer/pages/settings.js', 'desktop/renderer/pages/profile.js', 'desktop/renderer/pages/connections.js'],
  interviews: ['desktop/renderer/pages/interviews.js'],
  sessions: ['desktop/renderer/pages/sessions.js', 'desktop/renderer/pages/session-needs.js', 'desktop/renderer/pages/session-log.js'],
  wizard: ['desktop/renderer/pages/wizard.js'],
  actions: ['desktop/renderer/pages/activity.js'],
};
// The page a view name is about: "activity-notion-html" and "probe-strategy-1" both name one.
export function pageOf(view = '') {
  const parts = String(view).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return parts.find(part => PAGE_FILES[part]) || '';
}

// The files a finding is about: its page's own files, and for a failed step the suite file that asserts it. [] when nothing specific is known (the finding is then never held).
export function implicatedFiles(finding, {suite = ''} = {}) {
  const page = pageOf(finding.view) || pageOf(suite);
  const files = page ? [...PAGE_FILES[page]] : [];
  if (finding.source === 'suite-failure' && suite) files.push(`desktop/e2e/suites/${suite}.mjs`);
  return files;
}

// -> {hold, files}: held when main is ahead of the tested build and one of the finding's files is among those that changed. `changed`: the file names the compare API lists.
export function holdFinding(finding, {suite = '', behind = null, changed = []} = {}) {
  if (!Number.isFinite(behind) || behind <= 0 || !changed.length || finding.source === 'code-review') return {hold: false, files: []};
  const touched = new Set(changed);
  const files = implicatedFiles(finding, {suite}).filter(file => touched.has(file));
  return {hold: files.length > 0, files};
}

export const holdReason = (files, tested) => `held for recheck: ${files.slice(0, 3).join(', ')} changed since the tested build ${tested}; a run on a newer build files it if it is still there`;
