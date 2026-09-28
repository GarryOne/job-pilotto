// ⌘K (Ctrl+K on Windows): a command palette. Type a few words ("check gmail", "record", "settings"), then
// Enter. Every command is a button the app already has (clicked as if by hand) or a page to open.

// Words that carry no meaning in a request ("check FOR gmail", "open THE settings").
const FILLER = new Set(['a', 'an', 'the', 'for', 'to', 'my', 'me', 'of', 'in', 'on', 'go', 'please', 'new', 'now']);
const words = text => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean);

// Best matches first. A command matches when each meaningful query word starts one of its words (label first,
// then its keywords and hint); the label counts more. Filler words are ignored unless they're all you typed.
export function rank(commands, query) {
  const typed = words(query);
  const wanted = typed.filter(word => !FILLER.has(word));
  const terms = wanted.length ? wanted : typed;
  if (!terms.length) return commands.slice();
  const scored = [];
  commands.forEach((command, index) => {
    const label = words(command.label), rest = words(`${command.keywords || ''} ${command.hint || ''}`);
    let score = 0;
    for (const term of terms) {
      if (label.some(word => word.startsWith(term))) score += label[0].startsWith(term) ? 4 : 3;
      else if (rest.some(word => word.startsWith(term))) score += 1;
      else return;  // every meaningful word has to be found
    }
    scored.push({command, score, index});
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.command);
}

// The palette: a dialog with a search box and the ranked commands; ↑/↓ to move, Enter or a click to run.
export function openPalette(commands) {
  document.getElementById('palette')?.remove();
  const dialog = Object.assign(document.createElement('dialog'), {id: 'palette', className: 'palette'});
  const input = Object.assign(document.createElement('input'), {type: 'search', placeholder: 'Type a command, e.g. check gmail',
    ariaLabel: 'Command'});
  input.setAttribute('aria-controls', 'palette-list');
  const list = Object.assign(document.createElement('ul'), {id: 'palette-list', role: 'listbox'});
  const empty = Object.assign(document.createElement('p'), {className: 'palette-empty muted', textContent: 'No command matches.', hidden: true});
  const foot = Object.assign(document.createElement('p'), {className: 'palette-foot muted', textContent: '↑↓ to move · Enter to run · Esc to close'});
  dialog.append(input, list, empty, foot);
  document.body.append(dialog);

  let shown = [], active = 0;
  const close = () => { dialog.close(); dialog.remove(); };
  const run = command => { close(); command.run(); };
  const highlight = index => {
    active = Math.max(0, Math.min(index, shown.length - 1));
    [...list.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
    list.children[active]?.scrollIntoView({block: 'nearest'});
  };
  const render = () => {
    shown = rank(commands, input.value);
    list.replaceChildren(...shown.map((command, i) => {
      const item = Object.assign(document.createElement('li'), {role: 'option'});
      const label = Object.assign(document.createElement('b'), {textContent: command.label});
      item.append(label);
      if (command.hint) item.append(Object.assign(document.createElement('span'), {className: 'muted', textContent: command.hint}));
      if (command.group) item.append(Object.assign(document.createElement('small'), {textContent: command.group}));
      item.addEventListener('mousemove', () => { if (active !== i) highlight(i); });
      item.addEventListener('click', () => run(command));
      return item;
    }));
    empty.hidden = shown.length > 0;
    highlight(0);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); highlight(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(active - 1); }
    else if (event.key === 'Enter' && shown[active]) { event.preventDefault(); run(shown[active]); }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });  // a click on the backdrop
  render();
  dialog.showModal();
  input.focus();
}
