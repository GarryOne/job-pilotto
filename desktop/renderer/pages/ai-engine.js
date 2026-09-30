// The AI engine chooser, one component for the setup wizard's AI step and Settings → Connections → AI: two cards
// (Anthropic API key / Claude Code), the Claude Code status block with Verify, the plan-limit fallback and the note.
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
      {id: 'api', icon: 'key', title: TEXT.api.title, text: TEXT.api.text},
      {id: 'cli', icon: 'terminal', title: TEXT.cli.title, text: TEXT.cli.text,
        note: status && !status.installed ? 'Not found on this Mac' : ''},
    ], {selected: picked, onPick: pick, label: TEXT.title});
    const head = el('div', 'engine-head');
    head.append(el('h3', '', TEXT.title), el('p', 'muted small', TEXT.subtitle));
    const parts = [head];
    if (context === 'settings' && showOffer(shared.state?.settings, hasKey(), status)) parts.push(offerCard());
    parts.push(cards);
    if (notice) parts.push(notice);
    parts.push(statusBlock(cli));
    if (problem) parts.push(el('p', 'message error', problem));
    if (showFallback(picked, hasKey())) parts.push(fallbackRow());
    parts.push(el('p', 'muted small engine-note', TEXT.note));
    box.replaceChildren(...parts);
  };
  const statusBlock = cli => {
    const block = el('div', 'engine-status');
    const top = el('div', 'engine-status-head');
    const verify = el('button', 'link', busy ? 'Verifying…' : 'Verify');
    Object.assign(verify, {type: 'button', disabled: busy});
    verify.addEventListener('click', () => check());
    top.append(el('b', '', 'Claude Code status'), verify);
    block.append(top);
    const lines = el('div', 'engine-status-lines');
    for (const line of cli.lines) lines.append(pill(line.text, line.tone, {dot: true}));
    block.append(lines);
    if (cli.path) block.append(el('code', 'engine-path', cli.path));
    return block;
  };
  const fallbackRow = () => {
    const label = el('label', 'check-row');
    const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: fallbackOn(shared.state?.settings)});
    box.addEventListener('change', async () => { shared.state.settings = await window.pilot.setAiFallback(box.checked); });
    label.append(box, el('span', '', TEXT.fallback));
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
    text.append(el('strong', '', 'Use your own Claude Code?'), el('p', '', TEXT.notice));
    const yes = el('button', 'primary', 'Use Claude Code'), no = el('button', 'ghost', 'Cancel');
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
