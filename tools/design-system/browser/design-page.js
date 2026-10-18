// The design-system page's last script: sorts the drawn sections into Components, States and Tokens, puts the approved / legacy / proposed badge
// (design-status.json) on each title that is not approved (approved is the default look: a green dot in the contents), and builds the contents list with a status dot per entry. Runs after gallery.js and design-states.js.
const status = await fetch('/r/design-status.json').then(r => r.json()).catch(() => ({sections: {}}));
const TOKENS = ['Colours', 'Type', 'Corners and shadows'];
const $ = (tag, className, text) => Object.assign(document.createElement(tag), className ? {className} : {}, text ? {textContent: text} : {});
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const group = name => document.querySelector(`.dp-group[data-group="${name}"] .dp-group-body`);

for (const box of [...document.querySelectorAll('#gallery > .g-section')]) {
  const h2 = box.querySelector(':scope > h2'), title = h2.textContent;
  box.id = slug(title);
  box.dataset.status = status.sections?.[title] || '';
  if (box.dataset.status && box.dataset.status !== 'approved') h2.append($('span', `dp-badge ${box.dataset.status}`, box.dataset.status));
  const into = TOKENS.includes(title) ? 'Tokens' : title.startsWith('States:') ? 'States' : 'Components';
  if (into === 'States') h2.firstChild.textContent = title.replace(/^States:\s*/, '').replace(/^./, c => c.toUpperCase());
  group(into).append(box);
}
document.getElementById('gallery').remove();

const toc = document.querySelector('.dp-toc');
for (const part of document.querySelectorAll('.dp-group')) {
  toc.append($('div', 'dp-toc-group', part.dataset.group));
  for (const item of part.querySelectorAll('.dp-group-body > [id]')) {
    const link = $('a');
    link.href = `${location.pathname}#${item.id}`;   // the page has <base href="/r/">: a bare #id would leave the page
    link.append($('span', `dp-dot ${item.dataset.status || ''}`), document.createTextNode(item.dataset.short || item.querySelector('h2')?.firstChild.textContent || item.id));
    link.addEventListener('click', () => { if (item.tagName === 'DETAILS') item.open = true; });
    toc.append(link);
  }
}
