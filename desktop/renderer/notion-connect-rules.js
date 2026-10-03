// When the "Connect Notion" prompt must stay out of the way: pure rules, so they are tested without a window.
// 3 Oct 2026 (wizard e2e): a token connect started elsewhere (Settings, a pasted token) takes a minute (building, moving the strategy in), and a page that asked for Notion
// meanwhile reopened the prompt over the app. It then sat on "Moving your strategy and matches into Notion…" for ever, because only its own connect closes it, and blocked every click.

export const UNDERWAY_MS = 5 * 60000;   // a connect that sends no news for 5 minutes is over (or died)

// `since`: when the last progress news of a connect this prompt did not start arrived (0 = none).
export const connectUnderway = (since, now = Date.now()) => !!since && now - since < UNDERWAY_MS;

// A "this needs Notion" event while a connect is already underway: let it run, don't ask again.
export const ignoreGateEvent = ({since, now = Date.now()}) => connectUnderway(since, now);

// Progress news from a connect this prompt did not start: a prompt left open is stale, close it.
export const closeOnProgress = ({dialogOpen, ownConnect}) => !!dialogOpen && !ownConnect;
