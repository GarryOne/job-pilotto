// The component gallery: every token and component, built with the same code the screens use.
import {icon} from './icons.js';
import {el, moreButton, pill, tag, tile, TONES} from './components.js';

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
  button('Delete', 'ghost danger'), withIcon('search', 'Run new search', 'secondary'), withIcon('mic', 'Record interview', 'primary'),
  button('Disabled', 'primary', {disabled: true}), moreButton([{label: 'Open in Notion', run: () => {}}, '-', {label: 'Delete', danger: true, run: () => {}}]),
));

section('Pills', "pill(text, tone, {dot}) — tones: " + TONES.join(', '),
  row(...TONES.map(tone => pill(tone[0].toUpperCase() + tone.slice(1), tone))),
  row(...TONES.map(tone => pill(tone === 'good' ? 'Ready' : tone === 'signal' ? 'Transcribing' : tone === 'bad' ? 'Failed' : tone, tone, {dot: true}))));

section('Tags', 'tag(text, {title, onClick, busy})', row(
  tag('Kubernetes'), tag('Observability'), tag('+3', {title: 'AWS, Go, Linux'}), tag('📝 Kit', {onClick: () => {}}),
  tag('📄 Tailored CV', {onClick: () => {}}), tag('✂️ Tailoring CV…', {busy: true})));

section('Tiles', 'tile(icon, tone)', row(tile('mic'), tile('file', 'teal'), tile('search', 'info'), tile('mail', 'info'), tile('check', 'good'), tile('shield', 'warn')));
