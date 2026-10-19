// /admin/form-learning (Intelligence): is the learning loop working: the learned-fix funnel, the AI's answers per family, what people did with proposed answers. Real fills are on /admin/real-form-filling,
// the lab's sites on /admin/lab-form-filling. Guard: site/test/form-pages.test.js.
import {bestCaseSection} from './best-case.js';
import {answersSection} from './answer-metrics.js';
import {proposalCard} from './proposal-digest.js';
import {esc} from './stats.js';
import {familySection, funnelSection, recipesTile, trend} from './form-sections.js';
import {pageView, shell} from './form-shell.js';

export const page = (data, url = new URL('https://www.jobadabra.top/admin/form-learning')) => shell({title: 'Form Learning', icon: '🧬', data, url,
  inner: d => [`<div class="tiles">\n${recipesTile(d)}\n</div>`, familySection(d.families, d.learning?.sample), answersSection(d.answers, trend), proposalCard(d.learning?.proposals, esc), bestCaseSection(d.bestCase), funnelSection(d)].join('\n')});

export const view = pageView(page);
