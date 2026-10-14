// /admin/applying's page tabs (owner, 14 Oct 2026: "about 5-6-7 tables/sections on this page, too much to scroll, put them under tabs"): one tab bar under the tiles,
// one panel per tab, every section drawn into a panel. The bar reuses the Fixed tab's .tabs look and its #hash links (applying-fixed.js): #needs-fix, #fixed and #by-cause
// open the Fixes tab, whose own tabs then pick the list ("tabs in tabs", accepted by the owner for now). Owns PAGETABS_CSS and PAGETABS_SCRIPT, the client code that sits
// right after the tiles inside the page's fetch callback (needs el, app, d). Plain quotes only: it sits in a template literal. Guard: test/applying-pagetabs.test.js.

export const PAGE_TABS = [['resolution', 'Resolution'], ['fixes', 'Fixes'], ['pool', 'Pool'], ['replays', 'Replays'], ['coverage', 'Coverage']];
export const FIX_HASHES = ['#needs-fix', '#fixed', '#by-cause'];

export const PAGETABS_CSS = `.panel[hidden]{display:none}.panel>section:first-child,.panel>details:first-child{margin-top:18px;padding-top:0;border-top:0}`;

export const PAGETABS_SCRIPT = `
  const PAGE_TABS = ${JSON.stringify(PAGE_TABS)}, FIX_HASHES = ${JSON.stringify(FIX_HASHES)};
  const pageTabs = el('nav', {className: 'tabs pagetabs', role: 'tablist', 'aria-label': 'Applying sections'}), panels = Object.fromEntries(PAGE_TABS.map(([id]) => [id, el('div', {className: 'panel', role: 'tabpanel'})]));
  app.append(pageTabs, ...Object.values(panels));
  let fixHash = '#needs-fix';   // the Fixes tab reopens the list last shown in it
  const showPage = () => { const hash = typeof location !== 'undefined' ? location.hash : ''; if (FIX_HASHES.includes(hash)) fixHash = hash;
    const which = FIX_HASHES.includes(hash) ? 'fixes' : panels[hash.slice(1)] ? hash.slice(1) : PAGE_TABS[0][0];
    for (const [id, box] of Object.entries(panels)) box.hidden = id !== which;
    pageTabs.textContent = ''; pageTabs.append(...PAGE_TABS.map(([id, name]) => el('a', {href: id === 'fixes' ? fixHash : '#' + id, role: 'tab', 'aria-selected': String(id === which), className: id === which ? 'on' : '',
      textContent: id === 'pool' && d.pool.length ? name + ' · ' + d.pool.length : name}))); };
  showPage();
  if (typeof window !== 'undefined') window.addEventListener('hashchange', showPage);
`;
