// The component gallery: every token and component, built with the same code the screens use.
import {fillIcons, icon} from './icons.js';
import {choiceCards, el, moreButton, pill, tag, tile, TONES} from './components.js';

const root = document.getElementById('gallery');
const section = (title, note, ...children) => {
  const box = el('section', 'g-section');
  box.append(el('h2', '', title), ...(note ? [el('p', 'muted small', note)] : []), ...children);
  root.append(box);
};
const row = (...children) => { const line = el('div', 'g-row'); line.append(...children); return line; };
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Colours: each token's swatch, name and value (read from tokens.css, so this can't go stale).
const COLOURS = ['bg', 'surface', 'surface-2', 'ink', 'ink-2', 'muted', 'line', 'line-strong', 'navy', 'navy-active', 'on-navy-2',
  'signal', 'signal-ink', 'signal-soft', 'teal', 'teal-soft', 'amber', 'good', 'good-soft', 'warn', 'warn-soft',
  'bad', 'bad-soft', 'info', 'info-soft', 'violet', 'violet-soft'];
section('Colours', 'tokens.css → var(--name)', row(...COLOURS.map(name => {
  const swatch = el('div', 'g-swatch');
  const chip = el('span', 'g-chip');
  chip.style.setProperty('--c', `var(--${name})`);
  swatch.append(chip, el('b', '', `--${name}`), el('code', '', token(`--${name}`)));
  return swatch;
})));

section('Type', 'var(--fs-…)', ...['display', '2xl', 'xl', 'lg', 'base', 'md', 'sm', 'xs'].map(step => {
  const line = el('div', 'g-type', `--fs-${step} · ${token(`--fs-${step}`)} · Your next job, found for you`);
  line.style.setProperty('--size', `var(--fs-${step})`);
  return line;
}));

section('Corners and shadows', 'var(--r-…), var(--shadow-…)', row(...['r-sm', 'r-md', 'r-lg', 'r-pill'].map(name => {
  const box = el('div', 'g-box', `--${name}`);
  box.style.setProperty('--radius', `var(--${name})`);
  return box;
}), ...['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'].map(name => {
  const box = el('div', 'g-box g-shadow', `--${name}`);
  box.style.setProperty('--shadow', `var(--${name})`);
  return box;
})));

const button = (label, className, extra = {}) => Object.assign(el('button', className, label), extra);
const withIcon = (glyph, label, className) => { const b = el('button', `${className} with-icon`); b.append(icon(glyph), el('span', '', label)); return b; };
section('Buttons', 'button.primary / .secondary / .ghost / .link / .danger; .with-icon', row(
  button('Prepare', 'primary'), button('Save', 'secondary'), button('Close', 'ghost'), button('Open posting', 'link'),
  button('Delete', 'ghost danger'), withIcon('refresh', 'Check for new jobs', 'secondary'), withIcon('mic', 'Record interview', 'primary'),
  button('Disabled', 'primary', {disabled: true}), moreButton([{label: 'Open in Notion', run: () => {}}, '-', {label: 'Delete', danger: true, run: () => {}}]),
));

section('Pills', "pill(text, tone, {dot}) — tones: " + TONES.join(', '),
  row(...TONES.map(tone => pill(tone[0].toUpperCase() + tone.slice(1), tone))),
  row(...TONES.map(tone => pill(tone === 'good' ? 'Ready' : tone === 'signal' ? 'Transcribing' : tone === 'bad' ? 'Failed' : tone, tone, {dot: true}))));

section('Tags', 'tag(text, {title, onClick, busy})', row(
  tag('Kubernetes'), tag('Observability'), tag('+3', {title: 'AWS, Go, Linux'}), tag('📝 Kit', {onClick: () => {}}),
  tag('📄 Tailored CV', {onClick: () => {}}), tag('✂️ Tailoring CV…', {busy: true})));

section('Lit panel', '.is-lit (also .card.is-lit, .panel.is-lit): dot grid, amber glow from the top-left, thin amber edge. The one thing on a page that says "start here"', (() => {
  const box = document.createElement('div');
  box.className = 'card is-lit';
  box.style.padding = 'var(--sp-5)';
  box.innerHTML = '<h3>Up next</h3><p class="muted">Lit like the website\'s departures hall. Used by the sidebar, Focus → Up next and Settings → Appearance.</p>';
  return box;
})());
section('Tiles', 'tile(icon, tone)', row(tile('mic'), tile('file', 'teal'), tile('search', 'info'), tile('mail', 'info'), tile('check', 'good'), tile('shield', 'warn')));

section('Choice cards', 'choiceCards(choices, {selected, onPick}): one of a few options (Settings → AI engine, the setup wizard)',
  choiceCards([{id: 'api', icon: 'key', title: 'Anthropic API key', text: 'Uses your Anthropic API key.'},
    {id: 'cli', icon: 'terminal', title: 'Claude Code CLI', text: 'Uses your own Claude Code CLI and its Claude subscription.'}], {selected: 'cli'}));

section('Dialog parts', '.panel-dialog with .dialog-head / .dialog-lead / .dialog-foot; .composer + .tool; .attachment + .soft-button; .select-search; .check-row; .segmented.is-fill', (() => {
  const box = el('div');
  box.innerHTML = `<div class="composer"><textarea rows="2" placeholder="Paste a message here…"></textarea>
    <div class="composer-tools"><button class="tool"><i data-icon="paperclip"></i>Add screenshot</button>
    <button class="tool"><i data-icon="image"></i>Paste image</button></div></div>
    <div class="attachment"><img src="logo.png" alt=""><span class="attachment-name">screenshot.png</span><button class="soft-button">Remove</button></div>
    <div class="select-search" style="margin-top: var(--sp-3)"><i data-icon="search"></i><select><option>Find the right job automatically</option></select></div>
    <label class="check-row" style="margin-top: var(--sp-3)"><input type="checkbox"><span><span>I agreed to speak with the recruiter</span>
    <span class="muted small">Move the job to Screening</span></span></label>
    <div class="segmented is-fill" style="margin-top: var(--sp-3)"><button class="is-active">LinkedIn</button><button>Email</button>
    <button>Phone / call</button><button>Other</button></div>`;
  fillIcons(box);
  return box;
})());

section('Alerts', '.alert.tone-warn | tone-good | tone-info | tone-bad: icon, title, text, optional link (.alert-actions: a row of them)', row(...['warn', 'good', 'info', 'bad'].map(tone => {
  const box = el('div', `alert tone-${tone}`);
  box.innerHTML = tone === 'good'
    ? '<i data-icon="check-circle"></i><div><strong>Job created — Platform Engineer</strong><div class="alert-actions"><button class="link">Open job in Notion ↗</button><button class="link">Show in Jobs</button></div></div>'
    : `<i data-icon="info"></i><div><strong>${tone === 'warn' ? 'No job activity found' : 'Logged'}</strong><p>One line of detail.</p></div>`;
  fillIcons(box);
  return box;
})));

section('Settings parts', '.settings-nav (+ .nav-dot), .service-card with .service-state, .summary-card with .summary-rows and .arrow-link', (() => {
  const box = el('div');
  box.innerHTML = `<div class="settings-layout"><nav class="settings-nav"><button class="is-active"><i data-icon="columns"></i>Overview</button>
    <button><i data-icon="link"></i>Connections<span class="nav-dot"></span></button></nav>
    <div><div class="service-grid"><button class="service-card"><span class="ui-tile tone-good"></span><span><b>Notion</b>
      <span class="service-state is-on"><i data-icon="check"></i>Connected</span></span></button>
      <button class="service-card"><span><b>Telegram</b><span class="service-state"><i data-icon="info"></i>Not connected</span></span></button></div>
    <div class="summary-grid"><article class="summary-card"><div class="summary-head"><i data-icon="clock"></i><h3>Automation</h3></div>
      <p class="muted">Your job search schedule.</p><dl class="summary-rows"><dt>Job search</dt><dd>Every 4 hours</dd></dl>
      <button class="arrow-link">Manage automation</button></article></div></div></div>`;
  fillIcons(box);
  return box;
})());
