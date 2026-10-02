// A searchable "select": the native <select> stays the source of truth (its options, value and change event, so the code that fills and
// reads it is untouched); a search box with a list of matches sits in front of it. Used where the list is long (your jobs).
import {icon} from './icons.js';

// Every word you typed must be in the option's text (any order, any case); the groups with no match disappear.
export function filterOptions(groups, query = '') {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groups.map(({label, options}) => ({label, options: options.filter(o => words.every(w => o.text.toLocaleLowerCase().includes(w)))}))
    .filter(({options}) => options.length);
}

const groupsOf = select => [...select.children].reduce((out, node) => {
  const read = o => ({value: o.value, text: o.textContent});
  if (node.tagName === 'OPTGROUP') out.push({label: node.label, options: [...node.children].map(read)});
  else if (node.tagName === 'OPTION') {
    if (!out.length || out.at(-1).label) out.push({label: '', options: []});
    out.at(-1).options.push(read(node));
  }
  return out;
}, []);

let counter = 0;
export function searchSelect(select, {placeholder = 'Search company or job…'} = {}) {
  if (!select || select.dataset.searchSelect) return;
  select.dataset.searchSelect = '1';
  const id = `search-select-${++counter}`;
  const wrap = Object.assign(document.createElement('div'), {className: 'search-select'});
  const input = Object.assign(document.createElement('input'), {type: 'search', autocomplete: 'off', placeholder, id: `${id}-input`});
  const list = Object.assign(document.createElement('div'), {id: `${id}-options`, className: 'lead-job-options', hidden: true});
  Object.entries({role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': list.id}).forEach(([k, v]) => input.setAttribute(k, v));
  list.setAttribute('role', 'listbox');
  if (select.id) document.querySelector(`label[for="${select.id}"]`)?.setAttribute('for', input.id);
  select.before(wrap);
  const field = Object.assign(document.createElement('div'), {className: 'select-search'});  // icon + box: the icon centres on the box, not on the list below
  field.append(icon('search'), input);
  wrap.append(field, list, select);
  select.hidden = true;
  select.style.display = 'none';

  let active = -1, buttons = [];
  const shown = () => select.selectedOptions[0]?.textContent || '';
  const sync = () => { if (list.hidden) input.value = shown(); };
  const close = () => {
    list.hidden = true; active = -1;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    input.value = shown();
  };
  const choose = value => {
    const changed = select.value !== value;
    select.value = value;
    close();
    if (changed) select.dispatchEvent(new Event('change', {bubbles: true}));
  };
  const highlight = index => {
    buttons.forEach((b, i) => b.classList.toggle('is-active', i === index));
    active = index;
    const button = buttons[index];
    if (button) { input.setAttribute('aria-activedescendant', button.id); button.scrollIntoView({block: 'nearest'}); }
  };
  // typing: the matches; just opened (the box still shows the current pick): everything, the current pick highlighted.
  const render = (query, all) => {
    const groups = filterOptions(groupsOf(select), all ? '' : query);
    buttons = [];
    list.replaceChildren(...(groups.length ? groups.flatMap(({label, options}) => [
      ...(label ? [Object.assign(document.createElement('div'), {className: 'lead-job-group', textContent: label})] : []),
      ...options.map(o => {
        const button = Object.assign(document.createElement('button'), {type: 'button', className: 'lead-job-option', textContent: o.text,
          id: `${id}-option-${buttons.length}`});
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(o.value === select.value));
        button.addEventListener('mousedown', event => event.preventDefault());  // keep focus in the box, so blur doesn't close first
        button.addEventListener('click', () => choose(o.value));
        buttons.push(button);
        return button;
      })]) : [Object.assign(document.createElement('div'), {className: 'lead-job-empty', textContent: 'No matching jobs'})]));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(all ? Math.max(0, buttons.findIndex(b => b.getAttribute('aria-selected') === 'true')) : (buttons.length ? 0 : -1));
  };

  input.addEventListener('focus', () => { input.select(); render('', true); });
  input.addEventListener('input', () => render(input.value, false));
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) render('', true);
      else if (buttons.length) highlight((active + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const button = buttons[active];
      if (!list.hidden && button) button.click();
    } else if (event.key === 'Escape' && !list.hidden) {
      event.stopPropagation();  // closes the list, not the dialog around it
      event.preventDefault();
      close();
    }
  });

  // The code around sets .value and replaces the options: follow both.
  const own = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {get() { return own.get.call(this); }, set(v) { own.set.call(this, v); sync(); }, configurable: true});
  new MutationObserver(sync).observe(select, {childList: true, subtree: true, characterData: true});
  sync();
}
