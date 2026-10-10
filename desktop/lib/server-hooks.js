// The app's side of the extension server: what main.js plugs in (notifier, window signal, and one handler per extension message), kept as
// live bindings so the routes in server.js and the helpers in server-env.js always call the current one. Setters keep their names (re-exported
// by server.js). Guarded by desktop/test/local-server.test.js, extension-cors.test.js and targets.test.js.

// Desktop notifications for what happens in Chrome (set by main.js): the fill starting and finishing,
// and the application being marked Applied.
export let notify = () => {};
export const setNotifier = fn => { notify = fn; };
export let tellWindow = () => {};   // (channel, payload) -> the open window
export const setWindowSignal = fn => { tellWindow = fn; };
export const jobName = job => job ? `${job.title} · ${job.company}` : 'this job';
export let tabsHandler = () => {};
export let appliedHook = () => {};   // the app counts an application the extension saw submitted (lib/analytics.js)
export function setAppliedHook(fn) { appliedHook = fn; }
export let renderer = null;
export function setRenderer(fn) { renderer = fn; }   // (url) -> {status, html} | {error}: lib/page-render.js, bound in main.js
export function setTabsHandler(fn) { tabsHandler = fn; }  // ({ids, boot, reading}) -> read tabs to hand back: which Chrome tabs exist (lib/review.js binds sessions to them)

// In-app Claude sessions (terminals.js) report their state here: the Claude Code hooks (JSON on stdin, with a
// "message" for Notification) and tools/notify.sh (form field "message"). Local programs only, as for tickets.
export let sharedLogger = null;   // lib/shared-log.js: a copy of what is sent to the service, for Settings → "See what's sent"
export function setSharedLogger(fn) { sharedLogger = fn; }
export let answerReporter = () => {};   // each AI answer call's counts -> lib/recipes.js reporter.answer (set in ext-server-handlers.js)
export function setAnswerReporter(fn) { answerReporter = fn; }
export let proposalReporter = () => {};
export function setProposalReporter(fn) { proposalReporter = fn; }
export let sessionReporter = () => {};
export function setSessionReporter(fn) { sessionReporter = fn; }
// The application form page (extension/review.js) and its session: what is left in the form, what to show (lib/review.js).
export let reviewHandler = () => ({matched: null, watch: [], commands: []});
export let sitePasswordHandler = () => ({ok: false});
export let accountCodeHandler = async () => ({ok: false});
export function setAccountCodeHandler(fn) { accountCodeHandler = fn; }   // ({host, needs, session, job, url}) → {ok, code}: the email code, to the extension only (never logged)
export function setSitePasswordHandler(fn) { sitePasswordHandler = fn; }   // ({host}) → {ok, password}: the extension fills a sign-in/sign-up page (lib/credentials.js)
export function setReviewHandler(fn) { reviewHandler = fn; }
export let learnedHandler = () => {};
export function setLearnedHandler(fn) { learnedHandler = fn; }
export let visitHandler = async () => ({ok: false});   // a page the person opened and asked the extension to read (lib/visits.js)
export function setVisitHandler(fn) { visitHandler = fn; }
export let visitMore = {};   // '/extension/visit-understand', '/extension/visit-recipe': (payload) => answer (lib/visits.js)
export function setVisitRoute(route, fn) { visitMore[route] = fn; }
export let visitFilters = async () => ({ok: false});   // which filters to set on a page, for this search (lib/visits.js filters)
export function setVisitFilters(fn) { visitFilters = fn; }
export let visitHosts = () => [];   // the sites on the visit list, for the extension's toolbar icon
export function setVisitHosts(fn) { visitHosts = fn; }
export let missesHandler = () => {};
export function setMissesHandler(fn) { missesHandler = fn; }
export let controlsHandler = () => {};
export function setControlsHandler(fn) { controlsHandler = fn; }
export let aliasesHandler = async () => [];
export function setAliasesHandler(fn) { aliasesHandler = fn; }  // label meanings for the form in front of the extension (lib/aliases.js)
export let recipesHandler = async () => ({});
export function setRecipesHandler(fn) { recipesHandler = fn; }  // recipes for the fingerprints on a form (lib/recipes.js)  // how the generic operators fared (lib/control-events.js)  // controls the form model could not read (lib/misses.js)  // what you answered yourself in a form (lib/learned.js)
// Review in form, when the panel is not on the tab yet: which open tabs to inject into, and whether the field was there.
export let joinHandler = () => [];
export function setJoinHandler(fn) { joinHandler = fn; }
export let focusHandler = () => ({ok: false});
export function setFocusHandler(fn) { focusHandler = fn; }
// The panel's "Open in Job Pilotto": the app comes forward on that session's page.
export let accountPressedHandler = () => {};  // the extension pressed an account page's button (sign-up): the app records it and waits for the confirmation mail
export function setAccountPressedHandler(fn) { accountPressedHandler = fn; }
export let stuckHandler = () => {};  // the extension can't get to a form (no form / needs an account): the app's session offers Apply with Claude
export function setStuckHandler(fn) { stuckHandler = fn; }
export let takeOverHandler = () => {};  // the panel's "Take over with Claude": the person asks for Claude on this application (set by main.js)
export function setTakeOverHandler(fn) { takeOverHandler = fn; }
export let tailorHandler = () => {};  // the panel's "Tailor my CV for this job" (set by main.js)
export function setTailorHandler(fn) { tailorHandler = fn; }
export let formIssue = () => {};  // technical reports: a field the extension couldn't fill (lib/telemetry.js, set by main.js)
export function setFormIssueHandler(fn) { formIssue = fn; }
export let openHandler = () => false;
export function setOpenHandler(fn) { openHandler = fn; }
