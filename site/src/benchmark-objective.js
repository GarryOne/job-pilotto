// The "how objective is this" block at the top of /admin/benchmark-form-filling (owner, 15 Oct 2026): an internal trend, not an independent test. What tilts it toward us, and what would make it objective, each item
// ticked from the stored runs where they show it (days, runs behind each number, mode, held-out forms) and plain text where they cannot. Names no tool. Guard: test/benchmark.test.js.
import {esc} from './stats.js';

const fields = (a, b) => Math.abs(a - b);
// Fields of difference between ours and the best other tool on the same forms, and the noise of single runs (about 1 field per form).
export function gapFields(view) {
  const ours = view.tools.find(tool => tool.ours), best = view.tools.filter(tool => !tool.ours)[0];
  if (!ours || !best) return null;
  return {ours: ours.product, best: best.product, fields: fields(ours.right, best.right), noise: view.forms.length};
}
// The bake-off harness fixes the page knows (keys: benchmark-data.js FIX_KEYS); what each one changed in the score.
const FIXES = [['trail', '🧾 Old trail rule', 'a field the final page shows empty now counts as empty (before, a value typed and then cleared counted as filled)'],
  ['select', '🔽 Old select reader', 'a dropdown\'s chosen value is now read (before, every filled custom dropdown read as empty)']];
const days = o => (o.firstOtherDay === o.lastOtherDay ? o.firstOtherDay : `${o.firstOtherDay} to ${o.lastOtherDay}`) || 'none';

export function objectiveBlock(view) {
  const o = view.objectivity, gap = gapFields(view);
  const tilts = [
    ['🏠 Home field', 'We picked these forms and fixed our extension on them; the other tools never saw them before.'],
    ['🔍 Lopsided scrutiny', 'Judge corrections were made for our misses and not checked for the other tools\' misses.'],
    ['📅 Different days', o.sameDay ? `All tools ran on ${esc(o.ourDay)}.` : `Ours ran ${esc(o.ourDay || 'on no day')}; the others ${esc(days(o))}.`],
    ['⚙️ Their settings', 'We chose the other tools\' models and settings.'],
    ['🎲 Noise', gap ? `Single runs vary by about ±1 field per form: ${gap.noise} forms, so about ±${gap.noise} fields. The product gap, ${gap.ours}% against ${gap.best}%, is ${gap.fields} fields.` : 'Single runs vary by about ±1 field per form.'],
    ...FIXES.map(([key, name, what]) => [name, o.fixes[key] ? `${o.fixes[key]} of the ${o.shown} runs behind these numbers were scored before the bake-off's fix: ${what}. The old behaviour hit every tool the same way, so it shifts the levels more than the ranking.` : `Every run behind these numbers was scored after the bake-off's fix: ${what}.`]),
    ['🔧 Mode', o.userMode ? 'Ours runs in user mode, as real users do.' : 'Ours runs in harness mode (the test harness\'s repair rung is on); real users do not get it yet.'],
  ];
  const ok = (done, yes, no) => `${done ? '✅' : '❌'} ${done ? yes : no}`;
  const checks = [
    ok(o.heldout > 0 && o.heldout === o.forms, `All ${o.forms} forms were held out when picked.`, `${o.heldout} of ${o.forms} forms were held out when picked (not in our pool before): held-out forms we never fixed on.`),
    ok(o.sameDay && o.minRuns >= 3, `Every tool ran on the same day, ${o.minRuns} runs or more per form (average and spread).`, `Same day and 3 runs per form for every tool: ${o.sameDay ? 'same day' : 'different days'}, fewest runs behind a number: ${o.minRuns}.`),
    '❌ Blind judging, with every correction applied to all tools (stated, not measured here).',
    '❌ The other tools\' settings documented (stated, not measured here).',
    ok(o.userMode, 'Ours in user mode.', 'Ours in user mode (it is in harness mode).'),
  ];
  return `<div class="banner">⚠️ Internal trend, not independent yet. Read it to see our own progress build by build; do not read it as a ranking against other tools.</div>
<section class="card"><h2>What tilts it toward us</h2><table>${tilts.map(([name, text]) => `<tr><td class="nowrap">${name}</td><td>${text}</td></tr>`).join('')}</table></section>
<section class="card"><h2>What would make it objective</h2><ul class="checks">${checks.map(line => `<li>${line}</li>`).join('')}</ul></section>`;
}
