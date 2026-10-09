// The AI engine chooser's words and states (the setup wizard's AI step and Settings → Connections → AI), kept free of
// the DOM so the tests can check them. The user picks; nothing is chosen for them (lib/claude-code.js engine()).
export const TEXT = {
  title: 'Execution engine',
  families: {claude: 'Claude', openai: 'OpenAI'},   // the switch above the cards (owner, 9 Oct 2026: family first, then its two cards)
  subtitle: 'Where Job Pilotto\'s AI tasks run: reading jobs, fit scores, kits, reviews.',
  settingsSubtitle: 'Choose where AI tasks run.',  // Settings → Connections: the two cards under it say the rest
  details: 'Installation details',                 // the Claude Code path, folded under its status line
  api: {title: 'Anthropic API key', text: 'Uses your Anthropic API key. You control the model and costs.',
    short: 'Control the model and API costs.'},  // Settings shows the short line; the wizard explains in full
  cli: {title: 'Claude Code CLI', text: 'Uses your own Claude Code CLI (the claude command on this Mac) and its Claude subscription for the AI tasks here, with no API key or '
    + 'per-token costs for them. Scheduled runs in your GitHub repository (Always on) still use your API key.',
    short: 'Use your Claude subscription, for tasks on this Mac.'},
  openai: {title: 'OpenAI API key', text: 'Uses your OpenAI API key. You control the model and costs.',
    short: 'Control the model and API costs.'},
  codex: {title: 'Codex CLI', text: 'Uses your own Codex CLI (the codex command on this Mac) and your ChatGPT plan for the AI tasks here, with no API key or '
    + 'per-token costs for them. Scheduled runs in your GitHub repository (Always on) still use your OpenAI API key.',
    short: 'Use your ChatGPT plan, for tasks on this Mac.'},
  trial: {title: '$1 of free AI', text: 'Invited tester? Use your founder key: no Anthropic account or card needed. '
    + 'When the $1 is used, add your own key in Settings → Anthropic.'},  // the wizard only: a first-run offer
  note: 'AI tasks run through your Claude Code and bill to your Claude subscription, not to API credits. Always on (GitHub) '
    + 'and the free-credit relay use an API key. Tasks are retried later when your Claude usage window is exhausted.',
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

// Each engine's family, and the two cards of a family (API key first, then the user's own CLI).
export const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');
export const FAMILY_CARDS = {claude: ['api', 'cli'], openai: ['openai', 'codex']};
export const CLI_OF = {claude: 'cli', openai: 'codex'};

// The chosen engine: 'api', 'cli', 'openai', 'codex' or null. In Settings an install that had a key before the choice existed shows 'api'
// (it keeps running on the key); the wizard shows nothing chosen until the user picks.
export function chosen(settings = {}, hasKey = false, context = 'settings') {
  if (context === 'wizard' && settings.aiTrial) return 'trial';
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
// the free credit with the founder key typed: always asked, even when a license is already in the app (owner, 9 Oct 2026)).
export function canContinue({picked, hasKey = false, keyTyped = false, status = null, hasOpenAiKey = false}) {
  if (picked === 'trial') return keyTyped;
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
