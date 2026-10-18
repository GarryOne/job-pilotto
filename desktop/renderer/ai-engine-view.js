// The AI engine chooser's words and states (the setup wizard's AI step and Settings → Connections → AI), kept free of
// the DOM so the tests can check them. The user picks; nothing is chosen for them (lib/claude-code.js engine()).
const freeOn = settings => !!(settings?.aiFree || settings?.aiTrial);
export const usingFree = settings => freeOn(settings) && (!settings.aiEngine || settings.aiEngine === 'api');   // Free is the engine in charge (a later pick of another engine wins)
// The one-time hint after AI-written text on Free AI (renderer/own-key-hint.js): its words, and when it is wanted (Free, not shown yet).
export const HINT = {text: 'Want stronger letters? Connect your Claude account or ChatGPT.', link: 'Open AI engine settings', dismiss: 'Dismiss'};
export const hintWanted = settings => usingFree(settings) && !settings?.ownKeyHintSeen;   // = lib/ai-free.js isOn (the renderer cannot import lib/)

export const TEXT = {
  title: 'Execution engine',
  families: {claude: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)'},   // the two small cards under Free (owner, 16 Oct 2026; 9 Oct: family first, then its two cards)
  familyHint: {claude: 'Your Claude plan or API key', openai: 'Your ChatGPT plan or API key'},   // the company's logo on each card (owner, 16 Oct 2026)
  ownAccount: 'Or use your own account',
  ownQuality: 'Better letters and interview prep; uses your own subscription or key.',   // quality, never a number (owner, 16 Oct 2026)
  subtitle: 'Where Job Pilotto\'s AI tasks run: reading jobs, fit scores, kits, reviews.',
  settingsSubtitle: 'Choose where AI tasks run.',  // Settings → Connections: the two cards under it say the rest
  details: 'Installation details',                 // the Claude Code path, folded under its status line
  api: {title: 'API key', text: 'Pay as you go with your own key. You control the cost.',
    short: 'Pay as you go with your own key.'},  // Settings shows the short line; the wizard explains in full
  cli: {title: 'Your Claude subscription', text: 'Use the Claude plan you already pay for, through Claude Code on this Mac. Nothing extra to pay.',
    short: 'Use the plan you already pay for.'},
  openai: {title: 'API key', text: 'Pay as you go with your own key. You control the cost.',
    short: 'Pay as you go with your own key.'},
  codex: {title: 'Your OpenAI plan', text: 'Use the plan you already pay for, through Codex on this Mac. Nothing extra to pay.',
    short: 'Use the plan you already pay for.'},
  free: {title: 'Free', text: 'Nothing to set up: no account, no key, no cost. Job Pilotto\'s AI tasks just work. '
    + 'Want the best results? Add your own key any time.', short: 'No account, no key, no cost.'},
  note: 'AI tasks run through your Claude Code and bill to your Claude subscription, not to API credits. Always on (GitHub) '
    + 'uses an API key. Tasks are retried later when your Claude usage window is exhausted.',
  codexNote: 'AI tasks run through your Codex and count against your ChatGPT plan, not API credits. Always on (GitHub) uses your OpenAI API key. '
    + 'Tasks are retried later when your plan\'s limit is reached.',
  fallback: 'Use my API key if Claude Code reaches its limit',
  codexFallback: 'Use my OpenAI API key if Codex reaches its limit',
  fallbackHint: 'Otherwise, tasks retry when your usage window resets.',
  notice: 'Job Pilotto will run your own Claude Code on this Mac. It uses your Claude plan\'s usage limits, not API credits. '
    + 'Scheduled runs in your GitHub repository (Always on) still use your API key. '
    + 'You stay in control: switch back to an API key any time.',
  codexNotice: 'Job Pilotto will run your own Codex on this Mac, signed in with your ChatGPT account. It uses your plan\'s limits, not API credits. '
    + 'It runs read-only, in a fresh folder for each task, with its tools switched off. Scheduled runs (Always on) still use your OpenAI API key.',
  offer: 'New: run these AI tasks on your own Claude Code (your Claude plan) instead of API credits. Your API key stays as it is until you switch.',
};

// ⌘K: one entry per engine choice (the cards of pages/ai-engine.js, pressed by data-choice): [card, label, hint, search words, the family card to open first].
export const ENGINE_CHOICES = [
  ['free', 'Use Free AI', 'No account, no key, no cost', 'free no key'],
  ['family-claude', 'Use my own Claude account', 'Your Claude plan or API key', 'claude anthropic own key api'],
  ['family-openai', 'Use my own OpenAI account', 'Your ChatGPT plan or API key', 'openai chatgpt codex own key api'],
  ['cli', 'Use my Claude Code', 'Your Claude plan, for tasks on this Mac', 'claude code cli subscription', 'family-claude'],
  ['codex', 'Use my Codex', 'Your ChatGPT plan, for tasks on this Mac', 'codex cli chatgpt subscription', 'family-openai'],
];

// Each engine's family, and the two cards of a family (API key first, then the user's own CLI).
export const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');
export const FAMILY_CARDS = {claude: ['cli', 'api'], openai: ['codex', 'openai']};   // the subscription first, on the left (owner, 16 Oct 2026), then the API key
export const API_OF = {claude: 'api', openai: 'openai'};
export const CLI_OF = {claude: 'cli', openai: 'codex'};

// Who pays for an AI action, one quiet line before it runs and after it ran (owner, 18 Oct 2026, the cover letter's Draft with AI): never a guessed amount
// or time; after, the real cost only when one is known, an unknown one never "$0". The same three words as lib/cover-letter.js paidByOf.
export const PAID_BY = {free: 'credits', api: 'api', openai: 'api', cli: 'plan', codex: 'plan'};
export const USAGE = {credits: {before: 'Uses your AI credits.', after: 'Used your AI credits'}, api: {before: 'Billed to your API account.', after: 'Billed to your API account'},
  plan: {before: 'Uses your plan allowance.', after: 'Used your plan allowance'}};
const dollars = usd => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;
export const usageBefore = (settings, hasKey = false) => USAGE[PAID_BY[chosen(settings, hasKey)]]?.before || '';
export const usageAfter = ({paidBy = '', usd = 0} = {}) => (paidBy === 'api' && usd > 0 ? `Cost ${dollars(usd)}` : USAGE[paidBy]?.after || '');
// The last run's real cost, labelled as the past (never an estimate for the next one): only a measured amount on an API account.
export const lastCost = ({paidBy = '', usd = 0} = {}, what = 'draft') => (paidBy === 'api' && usd > 0 ? `Last ${what}: ${dollars(usd)}` : '');

// The chosen engine: 'api', 'cli', 'openai', 'codex' or null. In Settings an install that had a key before the choice existed shows 'api'
// (it keeps running on the key); the wizard shows nothing chosen until the user picks.
export function chosen(settings = {}, hasKey = false, context = 'settings') {
  if (context === 'wizard' && !freeOn(settings) && !['api', 'cli', 'openai', 'codex'].includes(settings.aiEngine) && !hasKey) return 'free';   // Free is preselected for a new user (owner, 16 Oct 2026)
  if (usingFree(settings)) return 'free';   // a later pick of another engine wins
  if (['api', 'cli', 'openai', 'codex'].includes(settings.aiEngine)) return settings.aiEngine;
  return context === 'settings' && hasKey ? 'api' : null;
}

// The Claude Code status block: dot lines (installed, signed in), the path, and whether it can be chosen.
export function cliStatus(status = null, family = 'claude') {
  const login = family === 'openai' ? 'run  codex login  in Terminal and sign in' : 'run claude in Terminal and sign in';
  if (!status) return {lines: [{tone: 'neutral', text: 'Checking…'}], path: '', usable: false, checking: true};
  const lines = [status.installed ? {tone: 'good', text: `Installed${status.version ? ` v${status.version}` : ''}`}
    : {tone: 'bad', text: 'Not installed on this Mac'}];
  if (status.installed) {
    lines.push(status.authenticated ? {tone: 'good', text: 'Authenticated'}
      : status.checkedAt ? {tone: 'bad', text: `Not signed in: ${login}, then Verify`}
        : {tone: 'warn', text: 'Not verified yet: press Verify'});
  }
  if (status.error && status.authenticated) lines.push({tone: 'warn', text: status.error});  // e.g. the usage window
  return {lines, path: status.path || '', usable: !!(status.installed && status.authenticated), checking: false};
}

// Wizard: Continue once a card is picked and it can run (Claude Code verified; the API card with a key saved or typed;
// Free AI always (nothing to type).
export function canContinue({picked, hasKey = false, keyTyped = false, status = null, hasOpenAiKey = false}) {
  if (picked === 'free') return true;
  if (picked === 'cli' || picked === 'codex') return cliStatus(status, familyOf(picked)).usable;
  if (picked === 'openai') return !!(hasOpenAiKey || keyTyped);
  if (picked === 'api') return !!(hasKey || keyTyped);
  return false;
}

// "Use my API key when Claude Code hits my plan limit": only with Claude Code chosen and a key saved. Off by default.
export const showFallback = (engine, hasKey, hasOpenAiKey = false) => (engine === 'cli' && !!hasKey) || (engine === 'codex' && !!hasOpenAiKey);
export const fallbackOn = settings => !!settings?.aiFallback;

// Settings: a small, non-blocking card for installs that already had an API key (they keep it): shown once,
// only when Claude Code is here and the user hasn't chosen an engine or dismissed it.
export const showOffer = (settings = {}, hasKey = false, status = null) =>
  !settings.aiEngine && !!hasKey && !settings.aiEngineOffered && !!status?.installed;

// The first-use notice: the first time the user picks Claude Code.
export const needsNotice = (settings, engine = 'cli') => (engine === 'codex' ? !settings?.codexNotice : !settings?.claudeCodeNotice);

// Recent activity: how a run was paid for, instead of "$0.03".
export function billingLabel(run = {}) {
  if (run.billing === 'Claude subscription') return 'Claude Code · your plan';
  if (run.billing === 'ChatGPT plan') return 'Codex · your plan';
  if (run.billing === 'Both') return `$${(run.usd || 0).toFixed(2)} + Claude Code`;
  return null;
}
