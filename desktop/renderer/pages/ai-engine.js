// The AI engine chooser, one component for the setup wizard's AI step and Settings → Connections → AI: a Claude | OpenAI switch, then that
// family's two cards (API key / its own CLI: Claude Code or Codex; the wizard adds $1 of free AI under Claude), the CLI's status block with Verify,
// the in-family plan-limit fallback and the note.
// The user picks; in the wizard nothing is pre-selected, in Settings the choice is remembered and switching is instant.
import {choiceCards, el, pill} from '../components.js';
import {icon} from '../icons.js';
import {CLI_OF, FAMILY_CARDS, TEXT, chosen, cliStatus, familyOf, fallbackOn, needsNotice, showFallback, showOffer} from '../ai-engine-view.js';
import {applyAiNames} from '../ai-name.js';
import {shared} from './shared.js';

const hasKey = () => !!shared.state?.secrets?.ANTHROPIC_API_KEY;
const hasOpenAiKey = () => !!shared.state?.secrets?.OPENAI_API_KEY;
const ICONS = {api: 'key', cli: 'terminal', openai: 'key', codex: 'terminal'};
// The family's own CLI, in words and through its IPC (Claude Code / Codex).
const CLI = {claude: {name: 'Claude Code CLI', status: () => window.pilot.claudeCodeStatus(), verify: () => window.pilot.verifyClaudeCode()},
  openai: {name: 'Codex CLI', status: () => window.pilot.codexStatus(), verify: () => window.pilot.verifyCodex()}};

// mountEngine(box, {context: 'wizard' | 'settings', onChange(picked)}) -> {picked(), refresh()}
export function mountEngine(box, {context = 'settings', onChange = () => {}} = {}) {
  let picked = chosen(shared.state?.settings, hasKey(), context), busy = false, notice = null, problem = '';
  let family = picked && picked !== 'trial' ? familyOf(picked) : 'claude';
  const statuses = {claude: null, openai: null};   // each family's CLI, found and verified separately
  const statusOf = () => statuses[family];
  // The family switch (owner, 9 Oct 2026: family first, then its two cards); switching it shows the other family's cards, it picks nothing.
  const familySwitch = () => {
    const box = el('div', 'segmented is-fill engine-family');   // the shared control (components.css), both halves the same width
    box.setAttribute('role', 'tablist');
    for (const [id, label] of Object.entries(TEXT.families)) {
      const button = el('button', id === family ? 'is-active' : '', label);
      Object.assign(button, {type: 'button'});
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(id === family));
      button.addEventListener('click', () => { if (family !== id) { family = id; problem = ''; notice = null; render(); onChange(picked); } });
      box.append(button);
    }
    return box;
  };
  const render = () => {
    const cli = cliStatus(statusOf(), family);
    const status = statusOf();
    const cards = choiceCards([
      ...FAMILY_CARDS[family].map(id => ({id, icon: ICONS[id], title: TEXT[id].title, text: context === 'settings' ? TEXT[id].short : TEXT[id].text,
        note: id === CLI_OF[family] && status && !status.installed ? 'Not found on this Mac' : ''})),
      ...(context === 'wizard' && family === 'claude' ? [{id: 'trial', icon: 'sparkle', title: TEXT.trial.title, text: TEXT.trial.text}] : []),   // $1 free AI: Claude only
    ], {selected: picked, onPick: pick, label: TEXT.title});
    // Settings: the key box under the chooser follows the family shown (Anthropic or OpenAI).
    if (context === 'settings') for (const foot of document.querySelectorAll('#setting-ai [data-family]')) foot.hidden = foot.dataset.family !== family;
    const head = el('div', 'engine-head');
    head.append(el('h3', '', TEXT.title), el('p', 'muted small', context === 'settings' ? TEXT.settingsSubtitle : TEXT.subtitle));
    const parts = [head];
    if (context === 'settings' && family === 'claude' && showOffer(shared.state?.settings, hasKey(), status)) parts.push(offerCard());
    parts.push(familySwitch(), cards);
    if (notice) parts.push(notice);
    // The wizard shows the family CLI's status and billing only for its card (picked, or nothing picked in this family yet); Settings always.
    const aboutCli = context === 'settings' || !picked || picked === CLI_OF[family] || familyOf(picked) !== family;
    if (aboutCli) parts.push(statusBlock(cli));
    if (problem) parts.push(el('p', 'message error', problem));
    const fallback = showFallback(picked, hasKey(), hasOpenAiKey()) && familyOf(picked) === family;
    if (fallback) parts.push(fallbackRow());
    // The fallback row's hint carries the retry line in Settings; the wizard (and the states without that row) keep
    // the full note, which is the only place the billing is explained there.
    if (aboutCli && !(fallback && context === 'settings')) parts.push(el('p', 'muted small engine-note', family === 'openai' ? TEXT.codexNote : TEXT.note));
    box.replaceChildren(...parts);
  };
  const statusBlock = cli => {
    const block = el('div', 'engine-status');  // one tinted line: the state, then Verify
    const row = el('div', 'engine-status-row');
    const verify = el('button', 'link', busy ? 'Verifying…' : 'Verify');
    Object.assign(verify, {type: 'button', disabled: busy});
    verify.addEventListener('click', () => check());
    const lines = el('div', 'engine-status-lines');
    for (const line of cli.lines) lines.append(pill(line.text, line.tone, {dot: true}));
    row.append(el('b', '', `${CLI[family].name} status`), lines, verify);
    block.append(row);
    if (cli.path) {  // the path is a detail, not the answer: folded away under the line
      const details = el('details', 'engine-details plain');
      details.append(el('summary', 'small', TEXT.details), el('code', 'engine-path', cli.path));
      block.append(details);
    }
    return block;
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
  const offerCard = () => {
    const card = el('div', 'alert tone-info engine-offer');
    const text = el('p', '', TEXT.offer);
    const dismiss = el('button', 'ghost', 'Not now');
    dismiss.addEventListener('click', async () => { shared.state.settings = await window.pilot.dismissEngineOffer(); render(); });
    card.append(icon('info'), text, dismiss);
    return card;
  };
  // The first time a CLI (Claude Code, Codex) is picked: what it means, then the user confirms.
  const askNotice = id => new Promise(resolve => {
    notice = el('div', 'alert tone-warn engine-notice');
    const text = el('div');
    text.append(el('strong', '', `Use your own ${CLI[familyOf(id)].name}?`), el('p', '', id === 'codex' ? TEXT.codexNotice : TEXT.notice));
    const yes = el('button', 'primary', `Use ${CLI[familyOf(id)].name}`), no = el('button', 'ghost', 'Cancel');
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
    picked = id;
    if (context === 'settings') shared.state.settings = await window.pilot.setAiEngine(id);  // instant, reversible
    else if (id === 'cli') shared.state.settings = {...shared.state.settings, claudeCodeNotice: true};
    else if (id === 'codex') shared.state.settings = {...shared.state.settings, codexNotice: true};
    applyAiNames();   // the window's static texts name the new engine at once
    window.dispatchEvent(new Event('claude-help'));   // and every Claude entry point (Jobs ⋯, Apply dialog, sessions) shows or hides with the family
    render();
    onChange(picked);
  }
  render();
  for (const which of Object.keys(CLI)) {
    CLI[which].status().then(found => { statuses[which] = found; render(); onChange(picked); }, () => { statuses[which] = {installed: false}; render(); });
  }
  return {picked: () => picked, family: () => family, status: () => statuses[familyOf(picked || CLI_OF[family])],
    refresh: () => { picked = chosen(shared.state?.settings, hasKey(), context) || picked; if (picked && picked !== 'trial') family = familyOf(picked); render(); }};
}

// Settings → Connections → AI: the same chooser, mounted once, redrawn each time Settings loads.
let settingsChooser = null;
export function showEngineSettings() {
  const box = document.getElementById('ai-engine-settings');
  if (!box) return;
  if (settingsChooser) settingsChooser.refresh(); else settingsChooser = mountEngine(box, {context: 'settings'});
}
