// The AI engine chooser, one component for the setup wizard's AI step and Settings → Connections → AI: one big Free card first, then two small
// cards, Claude and OpenAI (with their marks), for people with their own account; the one picked opens that family's two cards (API key / its own CLI:
// Claude Code or Codex), the CLI's status block with Verify,
// the in-family plan-limit fallback and the note.
// The user picks; in the wizard nothing is pre-selected, in Settings the choice is remembered and switching is instant.
import {refreshClaudeHelp} from '../claude-help.js';
import {choiceCards, el, pill} from '../components.js';
import {icon} from '../icons.js';
import {API_OF, CLI_OF, FAMILY_CARDS, TEXT, chosen, cliStatus, familyOf, fallbackOn, needsNotice, showFallback} from '../ai-engine-view.js';
import {applyAiNames} from '../ai-name.js';
import {shared} from './shared.js';

const hasKey = () => !!shared.state?.secrets?.ANTHROPIC_API_KEY;
const hasOpenAiKey = () => !!shared.state?.secrets?.OPENAI_API_KEY;
const COMPANY_LOGO = {claude: 'anthropic', openai: 'openai'};   // the companies' own marks (renderer/assets/ai/)
const ICONS = {api: 'key', cli: 'terminal', openai: 'key', codex: 'terminal'};
export const RECHECK_MS = 3000;   // how often a missing CLI is looked for again while its chooser is on screen
// The family's own CLI, in words and through its IPC (Claude Code / Codex).
const CLI = {claude: {name: 'Claude Code CLI', short: 'Claude Code', status: () => window.pilot.claudeCodeStatus(), verify: () => window.pilot.verifyClaudeCode()},
  openai: {name: 'Codex CLI', short: 'Codex', status: () => window.pilot.codexStatus(), verify: () => window.pilot.verifyCodex()}};

// mountEngine(box, {context: 'wizard' | 'settings', onChange(picked)}) -> {picked(), refresh()}
export function mountEngine(box, {context = 'settings', onChange = () => {}} = {}) {
  let picked = chosen(shared.state?.settings, hasKey(), context), busy = false, notice = null, problem = '';
  let family = picked && picked !== 'free' ? familyOf(picked) : null;   // null: no family open (Free picked, or nothing yet)
  const statuses = {claude: null, openai: null};   // each family's CLI, found and verified separately
  const statusOf = () => statuses[family];   // family is null while Free leads: nothing to read
  // The two small family cards under Free (owner, 16 Oct 2026; was a Claude | OpenAI switch): picking one opens that family's two cards, it picks no engine.
  const familyCards = () => {
    const cards = choiceCards(Object.entries(TEXT.families).map(([id, title]) => ({id: `family-${id}`, logo: COMPANY_LOGO[id], title, size: 'compact',
      text: TEXT.familyHint[id]})), {selected: family && `family-${family}`, label: TEXT.ownAccount, onPick: choice => {
      const id = choice.replace('family-', '');
      if (family !== id) { family = id; problem = ''; notice = null; render(); onChange(picked); }
    }});
    cards.classList.add('is-pair');
    return cards;
  };
  const render = () => {
    const cli = cliStatus(family && statusOf(), family || 'claude');
    const status = family && statusOf();   // (the offer banner "run these tasks on your own Claude Code" is gone: the subscription card is first now)
    // Free leads: one big card (owner, 16 Oct 2026: most early users are not technical), in the wizard and in Settings.
    const free = choiceCards([{id: 'free', icon: 'sparkle', title: TEXT.free.title, size: 'hero', text: context === 'settings' ? TEXT.free.short : TEXT.free.text}],
      {selected: picked, onPick: pick, label: TEXT.free.title});
    free.classList.add('is-single');
    // The engine cards of the open family (API key / its own CLI), only once a family is open.
    const cards = family ? choiceCards(FAMILY_CARDS[family].map(id => ({id, icon: ICONS[id], title: TEXT[id].title, text: context === 'settings' ? TEXT[id].short : TEXT[id].text,
      note: id === CLI_OF[family] && status && !status.installed ? 'Not found on this Mac' : ''})), {selected: picked, onPick: pick, label: TEXT.title}) : null;
    // Settings: the key box under the chooser shows only for the API key card of the open family (owner, 16 Oct 2026: hide technical details until asked).
    if (context === 'settings') for (const foot of document.querySelectorAll('#setting-ai [data-family]')) foot.hidden = !family || foot.dataset.family !== family || picked !== API_OF[family];
    const head = el('div', 'engine-head');
    head.append(el('h3', '', TEXT.title), el('p', 'muted small', context === 'settings' ? TEXT.settingsSubtitle : TEXT.subtitle));
    const parts = [head];
    parts.push(free, el('p', 'muted small engine-own', TEXT.ownAccount), familyCards());
    if (cards) parts.push(cards);
    if (notice) parts.push(notice);
    // Only the picked subscription card says more: one line (ready, or what is missing), the rest folded under "More about this".
    const aboutCli = !!family && picked === CLI_OF[family];
    if (aboutCli) parts.push(statusBlock(cli));
    if (problem) parts.push(el('p', 'message error', problem));
    if (aboutCli) parts.push(moreAbout(cli));
    box.replaceChildren(...parts);
  };
  const statusBlock = cli => {
    const block = el('div', 'engine-status');  // one tinted line: ready, or what is missing, then "Check again"
    const row = el('div', 'engine-status-row');
    const again = el('button', 'link', busy ? 'Checking…' : 'Check again');
    Object.assign(again, {type: 'button', disabled: busy});
    again.addEventListener('click', () => check());
    const lines = el('div', 'engine-status-lines');
    for (const line of cli.usable ? [{tone: 'good', text: 'Ready to use'}] : cli.lines.filter(each => each.tone !== 'good')) lines.append(pill(line.text, line.tone, {dot: true}));
    row.append(el('b', '', CLI[family].short), lines, again);
    block.append(row);
    return block;
  };
  // The technical rest, folded: version and path, how it is billed, and the plan-limit fallback.
  const moreAbout = cli => {
    const details = el('details', 'engine-details plain');
    details.append(el('summary', 'small', 'More about this'));
    for (const line of cli.lines.filter(each => each.tone === 'good')) details.append(el('p', 'muted small', line.text));
    if (cli.path) details.append(el('code', 'engine-path', cli.path));
    details.append(el('p', 'muted small engine-note', family === 'openai' ? TEXT.codexNote : TEXT.note));
    if (showFallback(picked, hasKey(), hasOpenAiKey()) && familyOf(picked) === family) details.append(fallbackRow());
    return details;
  };
  const fallbackRow = () => {
    const label = el('label', 'check-row');
    const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: fallbackOn(shared.state?.settings)});
    box.addEventListener('change', async () => { shared.state.settings = await window.pilot.setAiFallback(box.checked); });
    const words = el('span');
    words.append(el('span', '', family === 'openai' ? TEXT.codexFallback : TEXT.fallback), el('span', 'muted small', TEXT.fallbackHint));
    label.append(box, words);
    return label;
  };
  // The first time a CLI (Claude Code, Codex) is picked: what it means, then the user confirms.
  const askNotice = id => new Promise(resolve => {
    notice = el('div', 'alert tone-warn engine-notice');
    const text = el('div');
    text.append(el('strong', '', `Use your own ${CLI[familyOf(id)].name}?`), el('p', '', id === 'codex' ? TEXT.codexNotice : TEXT.notice));
    const yes = el('button', 'primary', `Use ${CLI[familyOf(id)].name}`), no = el('button', 'ghost', 'Cancel');
    yes.dataset.notice = 'yes';   // the e2e steps press it by this, whichever CLI it names
    yes.addEventListener('click', () => { notice = null; resolve(true); });
    no.addEventListener('click', () => { notice = null; render(); resolve(false); });
    notice.append(icon('info'), text, no, yes);
    render();
  });
  async function check() {
    busy = true; problem = ''; render();
    const which = family;
    try { statuses[which] = await CLI[which].verify(); } catch (error) { problem = error.message; }
    busy = false;
    if (statuses[which]?.error && !statuses[which].authenticated) problem = statuses[which].error;
    render();
    return cliStatus(statuses[which], which).usable;
  }
  async function pick(id) {
    problem = '';
    if (id === 'cli' || id === 'codex') {
      if (needsNotice(shared.state?.settings, id) && !(await askNotice(id))) return;
      if (!cliStatus(statusOf(), family).usable && !(await check())) { render(); return; }
    }
    if (id === 'free' && context === 'settings') {   // Free needs this install's token first; the wizard does it on Continue
      const started = await window.pilot.startFreeAi();
      if (!started.ok) { problem = started.error; render(); return; }
      shared.state.secrets = {...shared.state.secrets, ANTHROPIC_API_KEY: true};
    }
    picked = id;
    if (id === 'free') family = null;   // Free needs no family cards
    if (context === 'settings') shared.state.settings = await window.pilot.setAiEngine(id === 'free' ? 'api' : id);  // instant, reversible
    else if (id === 'cli') shared.state.settings = {...shared.state.settings, claudeCodeNotice: true};
    else if (id === 'codex') shared.state.settings = {...shared.state.settings, codexNotice: true};
    applyAiNames();   // the window's static texts name the new engine at once
    window.dispatchEvent(new Event('claude-help'));   // and every Claude entry point (Jobs ⋯, Apply dialog, sessions) shows or hides with the family
    refreshClaudeHelp();
    render();
    onChange(picked);
  }
  render();
  // Each CLI's status is read now and again whenever it could have changed: the window regains focus (the user came back from installing it),
  // and every few seconds while one is still missing. Installing Codex or Claude Code never needs an app restart.
  const recheck = () => {
    if (busy) return;   // a Verify in progress owns the status
    for (const which of Object.keys(CLI)) {
      CLI[which].status().then(found => {
        if (busy || JSON.stringify(found) === JSON.stringify(statuses[which])) return;
        statuses[which] = found; render(); onChange(picked);
      }, () => { if (!statuses[which]) { statuses[which] = {installed: false}; render(); } });
    }
  };
  recheck();
  const watch = () => { if (!box.isConnected) { clearInterval(timer); removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', onVisible); } };
  const onVisible = () => { if (!document.hidden) recheck(); };
  const timer = setInterval(() => { watch(); if (box.isConnected && Object.values(statuses).some(found => !found?.installed)) recheck(); }, RECHECK_MS);
  addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', onVisible);
  return {picked: () => picked, family: () => family, status: () => statuses[familyOf(picked || CLI_OF[family])],
    refresh: () => { picked = chosen(shared.state?.settings, hasKey(), context) || picked; if (picked === 'free') family = null; else if (picked) family = familyOf(picked); render(); }};
}

// Settings → Connections → AI: the same chooser, mounted once, redrawn each time Settings loads.
let settingsChooser = null;
export function showEngineSettings() {
  const box = document.getElementById('ai-engine-settings');
  if (!box) return;
  if (settingsChooser) settingsChooser.refresh(); else settingsChooser = mountEngine(box, {context: 'settings'});
}
