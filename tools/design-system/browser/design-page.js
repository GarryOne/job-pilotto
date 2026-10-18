// The design-system page's last script: reads design-status.json (the approved / legacy / proposed status of each gallery section), puts a badge on each section
// title, and builds the contents list from every section. Runs after gallery.js and design-states.js have drawn their sections.
const base = document.querySelector('base')?.href || '';
const status = await fetch(new URL('design-status.json', base)).then(r => r.json()).catch(() => ({sections: {}}));
const toc = document.querySelector('.dp-toc');
const link = (title, id) => { const a = document.createElement("a"); a.href = `${location.pathname}#${id}`; a.textContent = title; toc.append(a); };
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const group of document.querySelectorAll('[data-group]')) {
  const heading = document.createElement('div');
  heading.className = 'dp-group';
  heading.textContent = group.dataset.group;
  toc.append(heading);
  for (const h2 of group.querySelectorAll(':scope > section > h2, :scope > .g-section > h2')) {
    const title = h2.firstChild?.textContent || h2.textContent;
    h2.parentElement.id ||= slug(title);
    link(title, h2.parentElement.id);
    const state = status.sections?.[title];
    if (state) { const badge = document.createElement('span'); badge.className = `dp-badge ${state}`; badge.textContent = state; h2.append(badge); }
  }
}
