// A tailored CV made by editing the person's own PDF: each changed item of cv.json (summary, a role's bullets, its skills line) is found on
// the page and re-set on its own lines, bullets re-stacked in their new order with their markers. An item that can't be found or no longer
// fits keeps its original wording (a warning says so); nothing else on the page moves and the page count never changes. No drops: a bullet
// the tailoring left out goes back after the others. Pure planning here; lib/pdf-edit/write.js writes the plan. Guards: test/cv-inplace.test.js.
import {findItem, measure, setWords, resetItem} from './pdf-edit/layout.js';
import {markersOf, restack} from './pdf-edit/stack.js';

const plain = s => String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

// Every item of the CV that can be edited in place. -> [{where, kind, j, r, text, shows, para}] (para: how it is set)
export function itemsOf(doc, base) {
  const claimed = new Set(), out = [];
  const take = (where, text, extra) => {
    if (!plain(text)) return;
    const shows = findItem(doc, plain(text), claimed);
    if (shows) for (const {p, k} of shows) claimed.add(`${p}:${k}`);
    out.push({where, text: plain(text), shows, para: shows ? measure(doc, shows) : null, ...extra});
  };
  take('Summary', base.summary, {kind: 'summary'});
  (base.jobs || []).forEach((job, j) => (job.roles || []).forEach((role, r) => {
    const where = `${job.company} · ${role.title}`;
    (role.bullets || []).forEach((text, i) => { if (!role.extra?.includes(i)) take(where, text, {kind: 'bullet', j, r, i}); });
    if (role.skills) take(where, role.skills, {kind: 'skills', j, r});
  }));
  return out;
}

// How many characters each item may take on its lines (for the tailoring prompt): its length scaled by the room left on its lines.
export function roomOf(items) {
  const room = {summary: null, jobs: {}};
  for (const item of items) {
    if (!item.para) continue;
    const {lines, right, x0} = item.para;
    const used = lines.reduce((s, l) => s + l.x1 - l.x0, 0), free = lines.reduce((s, l, i) => s + right - x0(i), 0);
    const chars = Math.floor(item.text.length * Math.max(1, free / Math.max(used, 1)));
    if (item.kind === 'summary') room.summary = chars;
    else if (item.kind === 'bullet') ((room.jobs[item.j] ??= {})[item.r] ??= {})[item.i] = chars;
  }
  return room;
}

// doc: read.js's view of the original PDF. base: cv.json. review: applyTailoring's review (bullets [{text, from, mark}], dropped, skills).
// -> {plan: {remove, add, marks}, boxes: [{p, x, y, w, h, mark}], warnings, changed: count of items re-set, kept: count left as they were}
export function planInPlace(doc, base, review) {
  const items = itemsOf(doc, base), plan = {remove: [], add: [], marks: []}, boxes = [], warnings = [];
  let changed = 0, kept = 0;
  const keep = (where, why) => { kept++; warnings.push(`${where}: ${why}; kept your original wording`); };
  const set = (item, text, mark) => {
    if (!item.shows) return keep(item.where, 'not found on your CV page');
    const r = resetItem(doc, item.shows, text);
    if (!r.fits) return keep(item.where, r.missing ? `your CV's font has no "${r.missing}"` : 'the new wording is longer than its lines');
    plan.remove.push(...r.remove); plan.add.push(...r.add); changed++;
    boxes.push(...r.add.map(a => ({...a.box, mark})));
  };
  const summary = items.find(i => i.kind === 'summary');
  if (summary && plain(review.summary) !== summary.text) set(summary, review.summary, 'reworded');

  (base.jobs || []).forEach((job, j) => (job.roles || []).forEach((role, r) => {
    const tailored = review.jobs?.[j]?.roles?.[r];
    if (!tailored) return;
    const where = `${job.company} · ${role.title}`;
    const own = items.filter(i => i.kind === 'bullet' && i.j === j && i.r === r);   // in their original order
    const added = tailored.bullets.filter(b => role.extra?.includes(b.from));
    if (added.length) warnings.push(`${where}: ${added.length} added bullet${added.length > 1 ? 's' : ''} left out: your own CV design has no room for more lines`);
    // the new order over the bullets that are on the page; a left-out one goes back after the others (no drops in your own design)
    const order = tailored.bullets.map(b => own.findIndex(i => i.i === b.from)).filter(x => x >= 0);
    own.forEach((_, x) => { if (!order.includes(x)) order.push(x); });
    const textOf = x => plain(tailored.bullets.find(b => b.from === own[x].i)?.text ?? own[x].text);
    const markOf = x => tailored.bullets.find(b => b.from === own[x].i)?.mark || 'kept';
    const texts = own.map((_, x) => textOf(x));
    const moved = order.some((x, pos) => x !== pos), reworded = own.filter((item, x) => texts[x] !== item.text);
    let done = false;
    if (own.length > 1 && own.every(i => i.para) && (moved || reworded.some((item) => !setWords(item.para, texts[own.indexOf(item)]).fits))) {
      const paras = own.map(i => i.para), markers = own.map(i => markersOf(doc, i.para));
      let stacked = restack(doc, paras, markers, order, texts);
      if (stacked.why === 'longer than the block') {   // keep the new order: the bullets that grew a line go back to their own wording
        const grew = own.map((item, x) => texts[x] !== item.text && setWords(item.para, texts[x], Infinity).lines.length > item.para.lines.length);
        const fallback = texts.map((t, x) => (grew[x] ? own[x].text : t));
        const again = grew.some(Boolean) ? restack(doc, paras, markers, order, fallback) : stacked;
        if (!again.why) { grew.forEach((g, x) => { if (g) keep(where, 'the new wording is longer than its lines'); }); texts.splice(0, texts.length, ...fallback); stacked = again; }
      }
      if (!stacked.why && !moved && texts.every((t, x) => t === own[x].text)) done = true;   // nothing left to change
      else if (!stacked.why) {
        plan.remove.push(...stacked.remove); plan.add.push(...stacked.add); plan.marks.push(...stacked.marks);
        own.forEach((_, x) => { if (texts[x] !== own[x].text || moved) { changed++; boxes.push(...stacked.boxes[x].map(b => ({...b, mark: markOf(x)}))); } });
        done = true;
      } else if (moved) warnings.push(`${where}: kept the original order of the bullets (${stacked.why})`);
    }
    if (!done) own.forEach((item, x) => { if (texts[x] !== item.text) set(item, texts[x], 'reworded'); });
    const skills = items.find(i => i.kind === 'skills' && i.j === j && i.r === r);
    if (skills && tailored.skills && plain(tailored.skills) !== skills.text) set(skills, tailored.skills, 'reworded');
  }));
  return {plan, boxes, warnings, changed, kept};
}
