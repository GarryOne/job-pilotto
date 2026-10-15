// /admin/lab-form-filling's "By-hand runs · where each site got to" bars, in the Outcomes tab (moved here from the Pool tab, 15 Oct 2026, owner restructure): one bar per day of pool runs, split by each run's one status.
// The client code sits inside src/applying.js's page (needs el, d, panels); plain quotes only, it is in a template literal. Guard: test/applying-pagetabs.test.js (each section in its tab).
export const NIGHTS_SCRIPT = `
  // By-hand runs · where each site got to (owner, 10 Oct 2026: at the top; 14 Oct 2026: by each run's one status, not the step it reached; the pool has had no nights since 11 Oct): one bar per day, newest first,
  // every run of that day split by its status (the segment's width is its share, its number the count). The % is works against needs a fix only: a day with more holds or site problems is not a drop.
  if (d.nights.length) {
    const dayWord = day => { const [, month, date] = day.split('-'); return Number(date) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]; };
    const rows = d.nights.slice(-14).reverse().map(night => { const total = d.states.reduce((sum, state) => sum + night.counts[state], 0), measured = night.counts.works + night.counts.fix, apart = night.counts.held + night.counts.site;
      return el('div', {className: 'night'}, el('b', {textContent: dayWord(night.day)}),
        el('div', {className: 'nightbar'}, ...d.states.filter(state => night.counts[state]).map(state => { const count = night.counts[state];
          return el('i', {className: 'st-' + state, title: d.stateWords[state] + ': ' + count + ' of ' + total, style: 'flex:' + count + ' 1 0', textContent: count}); })),
        el('span', {className: 'muted', textContent: total + (total === 1 ? ' run' : ' runs') + ' · ' + (measured ? Math.round(100 * night.counts.works / measured) + '% work' + (apart ? ' · ' + apart + ' held or site' : '') : 'none measured'), title: measured ? 'Works against needs a fix. ' + night.counts.held + ' held on purpose and ' + night.counts.site + ' site problems are left out of the share' : ''})); });
    panels.outcomes.append(el('section', {className: 'nights'}, el('h2', {textContent: 'By-hand runs · where each site got to'}),
      el('p', {className: 'muted', textContent: 'Each bar is the pool runs of one day, split by each run\\'s one status (the key above the bars; hover a status pill in the pool table for its meaning). The % counts works against needs a fix only: held on purpose and site problems are left out, so a day with more of them does not read as a drop. The last 14 days, the latest first.'}),
      el('p', {className: 'muted', textContent: 'Each day runs a different set of sites (13-14 Oct: 18-22 hand-picked rows; 11 Oct: 196), so compare a site\\'s own dots in the pool table, not one bar with another.'}),
      el('div', {className: 'key'}, ...d.states.map(state => el('span', {className: 'pill st-' + state, textContent: d.stateWords[state]}))), ...rows));
  }
`;
