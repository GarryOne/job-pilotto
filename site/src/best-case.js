// Form Learning's "Learning loop: best case (parked)": the most a learned fix could win back, from the lab's last 14 days (src/left-empty.js, the pool's fill cards): the share of required fields lost
// to controls, the part of that a recipe can express (RECIPE_EXPRESSIBLE: one fixed list next to GROUP_OF), and their product. An estimate, an upper bound: it assumes every expressible field would be
// fixed. The loop was parked on 15 Oct 2026 (Discussion #803). Guard: site/test/best-case.test.js.
import {RECIPE_EXPRESSIBLE} from './left-empty.js';

const pct = value => (value == null ? '–' : `${(Math.round(value * 1000) / 10).toString()}%`);

// model: leftEmpty(db, now, 'lab') -> {required, control, expressible, lost, expressibleShare, recovered, perWeek, words}
export function bestCase(model) {
  const control = model.groups.find(group => group.key === 'control') || {count: 0, words: []};
  const expressible = control.words.filter(item => RECIPE_EXPRESSIBLE.includes(item.word)).reduce((sum, item) => sum + item.count, 0);
  const required = model.required || 0;
  const lost = required ? control.count / required : null, inside = control.count ? expressible / control.count : null;
  return {required, control: control.count, expressible, lost, expressibleShare: inside, recovered: required ? expressible / required : null, perWeek: (expressible * 7) / (model.days || 14), days: model.days || 14,
    words: control.words.filter(item => RECIPE_EXPRESSIBLE.includes(item.word)).map(item => item.word)};
}

export function bestCaseSection(model) {
  if (!model) return '';
  const best = bestCase(model);
  return `<section class="card"><h2>🧪 Learning loop: best case (parked) <span class="muted">· estimate</span></h2><small class="muted">The most a learned fix (a recipe) could win back, from the pool's fills of the last ${best.days} days. An upper bound: it assumes every field a recipe can express would be fixed. Parked 15 Oct 2026, see Discussion #803.</small>
<div class="wrap"><table><tr><th>Step</th><th class="n">Share</th><th>Of</th></tr>
<tr><td>Lost to controls</td><td class="n">${pct(best.lost)}</td><td class="muted">${best.control} of ${best.required} required fields</td></tr>
<tr><td>…of which a learned fix can express</td><td class="n">${pct(best.expressibleShare)}</td><td class="muted">${best.expressible} of ${best.control} control fields (${best.words.join(', ') || 'none'})</td></tr>
<tr><td><b>Best case recovered</b></td><td class="n"><b>${pct(best.recovered)}</b></td><td class="muted">of required fields · about ${Math.round(best.perWeek * 10) / 10} fields a week</td></tr></table></div></section>`;
}
