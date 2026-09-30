// The AI engine chooser's words and states (the setup wizard's AI step and Settings → Connections → AI), kept free of
// the DOM so the tests can check them. The user picks; nothing is chosen for them (lib/claude-code.js engine()).
export const TEXT = {
  title: 'Execution engine',
  subtitle: 'Where Job Pilotto\'s AI tasks run: reading jobs, fit scores, kits, reviews.',
  settingsSubtitle: 'Choose where AI tasks run.',  // Settings → Connections: the two cards under it say the rest
  details: 'Installation details',                 // the Claude Code path, folded under its status line
  api: {title: 'Anthropic API key', text: 'Uses your Anthropic API key. You control the model and costs.',
    short: 'Control the model and API costs.'},  // Settings shows the short line; the wizard explains in full
  cli: {title: 'Claude Code', text: 'Uses your Claude Code and its Claude subscription. No API key or per-token costs.',
    short: 'Use your Claude subscription.'},
  note: 'AI tasks run through your Claude Code and bill to your Claude subscription, not to API credits. Always on (GitHub) '
    + 'and the free-credit relay use an API key. Tasks are retried later when your Claude usage window is exhausted.',
  fallback: 'Use my API key if Claude Code reaches its limit',
  fallbackHint: 'Otherwise, tasks retry when your usage window resets.',
  notice: 'Job Pilotto will run your own Claude Code on this Mac. It uses your Claude plan\'s usage limits, not API credits. '
    + 'You stay in control: switch back to an API key any time.',
  offer: 'New: run these AI tasks on your own Claude Code (your Claude plan) instead of API credits. Your API key stays as it is until you switch.',
};

// The chosen engine: 'api', 'cli' or null. In Settings an install that had a key before the choice existed shows 'api'
// (it keeps running on the key); the wizard shows nothing chosen until the user picks.
export function chosen(settings = {}, hasKey = false, context = 'settings') {
  if (settings.aiEngine === 'api' || settings.aiEngine === 'cli') return settings.aiEngine;
  return context === 'settings' && hasKey ? 'api' : null;
}

// The Claude Code status block: dot lines (installed, signed in), the path, and whether it can be chosen.
export function cliStatus(status = null) {
  if (!status) return {lines: [{tone: 'neutral', text: 'Checking…'}], path: '', usable: false, checking: true};
  const lines = [status.installed ? {tone: 'good', text: `Installed${status.version ? ` v${status.version}` : ''}`}
    : {tone: 'bad', text: 'Not installed on this Mac'}];
  if (status.installed) {
    lines.push(status.authenticated ? {tone: 'good', text: 'Authenticated'}
      : status.checkedAt ? {tone: 'bad', text: 'Not signed in: run claude in Terminal and sign in, then Verify'}
        : {tone: 'warn', text: 'Not verified yet: press Verify'});
  }
  if (status.error && status.authenticated) lines.push({tone: 'warn', text: status.error});  // e.g. the usage window
  return {lines, path: status.path || '', usable: !!(status.installed && status.authenticated), checking: false};
}

// Wizard: Continue once a card is picked and it can run (Claude Code verified; the API card with a key saved or typed).
export function canContinue({picked, hasKey = false, keyTyped = false, status = null}) {
  if (picked === 'cli') return cliStatus(status).usable;
  if (picked === 'api') return !!(hasKey || keyTyped);
  return false;
}

// "Use my API key when Claude Code hits my plan limit": only with Claude Code chosen and a key saved. Off by default.
export const showFallback = (engine, hasKey) => engine === 'cli' && !!hasKey;
export const fallbackOn = settings => !!settings?.aiFallback;

// Settings: a small, non-blocking card for installs that already had an API key (they keep it): shown once,
// only when Claude Code is here and the user hasn't chosen an engine or dismissed it.
export const showOffer = (settings = {}, hasKey = false, status = null) =>
  !settings.aiEngine && !!hasKey && !settings.aiEngineOffered && !!status?.installed;

// The first-use notice: the first time the user picks Claude Code.
export const needsNotice = settings => !settings?.claudeCodeNotice;

// Recent activity: how a run was paid for, instead of "$0.03".
export function billingLabel(run = {}) {
  if (run.billing === 'Claude subscription') return 'Claude Code · your plan';
  if (run.billing === 'Both') return `$${(run.usd || 0).toFixed(2)} + Claude Code`;
  return null;
}
