// The AI engine chooser, one component for the setup wizard's AI step and Settings → Connections → AI: two cards
// (Anthropic API key / Claude Code; the wizard adds a third, $1 of free AI), the Claude Code status block with Verify, the plan-limit fallback and the note.
// The user picks; in the wizard nothing is pre-selected, in Settings the choice is remembered and switching is instant.
import {choiceCards, el, pill} from '../components.js';
import {icon} from '../icons.js';
import {TEXT, chosen, cliStatus, fallbackOn, needsNotice, showFallback, showOffer} from '../ai-engine-view.js';
import {shared} from './shared.js';

const hasKey = () => !!shared.state?.secrets?.ANTHROPIC_API_KEY;

// mountEngine(box, {context: 'wizard' | 'settings', onChange(picked)}) -> {picked(), refresh()}
export function mountEngine(box, {context = 'settings', onChange = () => {}} = {}) {
  let picked = chosen(shared.state?.settings, hasKey(), context), status = null, busy = false, notice = null, problem = '';
  const render = () => {
    const cli = cliStatus(status);
    const cards = choiceCards([
      {id: 'api', icon: 'key', title: TEXT.api.title, text: context === 'settings' ? TEXT.api.short : TEXT.api.text},
      {id: 'cli', icon: 'terminal', title: TEXT.cli.title, text: context === 'settings' ? TEXT.cli.short : TEXT.cli.text,
        note: status && !status.installed ? 'Not found on this Mac' : ''},
      ...(context === 'wizard' ? [{id: 'trial', icon: 'sparkle', title: TEXT.trial.title, text: TEXT.trial.text}] : []),
    ], {selected: picked, onPick: pick, label: TEXT.title});
    const head = el('div', 'engine-head');
    head.append(el('h3', '', TEXT.title), el('p', 'muted small', context === 'settings' ? TEXT.settingsSubtitle : TEXT.subtitle));
    const parts = [head];
    if (context === 'settings' && showOffer(shared.state?.settings, hasKey(), status)) parts.push(offerCard());
    parts.push(cards);
    if (notice) parts.push(notice);
    // The wizard shows Claude Code's status and billing only for its card (picked, or nothing picked yet); Settings always.
    const aboutCli = context === 'settings' || !picked || picked === 'cli';
    if (aboutCli) parts.push(statusBlock(cli));
    if (problem) parts.push(el('p', 'message error', problem));
    const fallback = showFallback(picked, hasKey());
    if (fallback) parts.push(fallbackRow());
    // The fallback row's hint carries the retry line in Settings; the wizard (and the states without that row) keep
    // the full note, which is the only place the billing is explained there.
    if (aboutCli && !(fallback && context === 'settings')) parts.push(el('p', 'muted small engine-note', TEXT.note));
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
    row.append(el('b', '', 'Claude Code CLI status'), lines, verify);
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
    words.append(el('span', '', TEXT.fallback), el('span', 'muted small', TEXT.fallbackHint));
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
  // The first time Claude Code is picked: what it means, then the user confirms.
  const askNotice = () => new Promise(resolve => {
    notice = el('div', 'alert tone-warn engine-notice');
    const text = el('div');
    text.append(el('strong', '', 'Use your own Claude Code CLI?'), el('p', '', TEXT.notice));
    const yes = el('button', 'primary', 'Use Claude Code CLI'), no = el('button', 'ghost', 'Cancel');
    yes.addEventListener('click', () => { notice = null; resolve(true); });
    no.addEventListener('click', () => { notice = null; render(); resolve(false); });
    notice.append(icon('info'), text, no, yes);
    render();
  });
  async function check() {
    busy = true; problem = ''; render();
    try { status = await window.pilot.verifyClaudeCode(); } catch (error) { problem = error.message; }
    busy = false;
    if (status?.error && !status.authenticated) problem = status.error;
    render();
    return cliStatus(status).usable;
  }
  async function pick(id) {
    problem = '';
    if (id === 'cli') {
      if (needsNotice(shared.state?.settings) && !(await askNotice())) return;
      if (!cliStatus(status).usable && !(await check())) { render(); return; }
    }
    picked = id;
    if (context === 'settings') shared.state.settings = await window.pilot.setAiEngine(id);  // instant, reversible
    else if (id === 'cli') shared.state.settings = {...shared.state.settings, claudeCodeNotice: true};
    render();
    onChange(picked);
  }
  render();
  window.pilot.claudeCodeStatus().then(found => { status = found; render(); onChange(picked); }, () => { status = {installed: false}; render(); });
  return {picked: () => picked, status: () => status, refresh: () => { picked = chosen(shared.state?.settings, hasKey(), context) || picked; render(); }};
}

// Settings → Connections → AI: the same chooser, mounted once, redrawn each time Settings loads.
let settingsChooser = null;
export function showEngineSettings() {
  const box = document.getElementById('ai-engine-settings');
  if (!box) return;
  if (settingsChooser) settingsChooser.refresh(); else settingsChooser = mountEngine(box, {context: 'settings'});
}
