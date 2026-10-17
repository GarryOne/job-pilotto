// The unclear fields of Your details as items of the one review queue (owner, 18 Oct 2026: "One queue for all"): "Which is right?" (two copies of a fact
// disagree, lib/profile-move.js openConflicts), "Where does this go?" (the move's AI answered "unsure"), a kind to check (a typed line kept as written: the
// "Check" chip of renderer/fact-line.js, one rule: needsCheck) and a ❓ on the Profile that nothing asked. Each item has the queue's shape ({key, question,
// format, hint, value}) plus .details {kind, source, where}; lib/question-lists.js openShown adds them to the list the Jobs card, the drawer and the Profile
// banner count. answer() saves into the item's home: a Your details section, else the line's own place on the Profile. Guarded by test/details-review.test.js.
import {openStore} from './store/index.js';
import * as sections from './profile-sections.js';
import {itemsOf, judge, keepUnsure, openConflicts, resolve} from './profile-move.js';
import * as formats from './question-formats.js';
import {HOME_NAMES, homeOf, writeHome} from './answer-home.js';
import {formatFor} from '../renderer/question-kind.js';
import {keyOf} from '../renderer/question-filter.js';
import {needsCheck} from '../renderer/question-values.js';
import {PARTS, splitNote} from '../renderer/experience-profile-model.js';

export const PREFIX = 'details:';
export const KINDS = ['which', 'where', 'check', 'open'];
export const KEEP = 'Keep on the Profile';
const SOURCES = {which: 'Two copies disagree', where: 'Not sure where it belongs', check: 'Saved as you wrote it', open: '❓ on your Profile'};
const PAGES = {profile: 'Profile', answers: 'Application answers'};
const plain = text => String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const same = text => plain(text).toLowerCase();
const asked = value => /^❓/.test(plain(value));
// The ids of the lines under a Profile part that has its own screen of answers (CV gaps' ✓ / ✕, the surveys, Experience): their ❓ is asked there, not here.
function ownedElsewhere(outline) {
  const ids = new Set();
  let level = 0;
  for (const entry of outline) {
    if (/^heading_/.test(entry.type || '')) {
      const depth = Number(entry.type.slice(-1)) || 1;
      if (!(level && depth > level)) level = Object.values(PARTS).some(part => part.match.test(splitNote(entry.text).title)) ? depth : 0;
    } else if (level) [entry, ...(entry.rows || [])].forEach(each => ids.add(each.id));
  }
  return ids;
}
// A ❓ that stands for the answer ("Industries: ❓ to confirm"), not one inside an answer ("SRE; ❓ DevOps?").
const isAsk = (label, text) => /^❓/.test(plain(text).slice(plain(label).length).replace(/^[\s|:—–-]+/, ''));
const hintOf = text => plain(text).split('❓').slice(1).join(' ').replace(/^[\s|:—–-]+/, '').replace(/^(to confirm|optional)\b\s*[—:-]?\s*/i, '').trim();
const choice = options => ({kind: 'single', list: '', options, constraints: false, control: 'single'});
const keyFor = (kind, ref) => `${PREFIX}${kind}:${JSON.stringify(ref)}`;
export const isDetailsKey = key => String(key || '').startsWith(PREFIX);
function parse(key) {
  const rest = String(key).slice(PREFIX.length), at = rest.indexOf(':');
  try { return {kind: rest.slice(0, at), ref: JSON.parse(rest.slice(at + 1))}; } catch { return {kind: '', ref: {}}; }
}
const item = (kind, ref, fields) => ({key: keyFor(kind, ref), company: '', hint: '', ...fields, details: {kind, source: SOURCES[kind], ...fields.details}});

// The queue items, as the pages are now (a line gone from its page is not asked). Reads the Profile, and the answers page only when a choice is there.
export async function pending(storage, {fetcher} = {}) {
  const opened = openStore(storage, {fetcher}), kept = formats.kept(storage);
  const found = await sections.read(storage, fetcher);
  const outlines = {profile: await opened.page('profile').outline()};
  const outline = async page => (outlines[page] ||= await opened.page(page).outline());
  const out = [];
  for (const conflict of await openConflicts(storage, {fetcher}).catch(() => [])) {
    const values = [...new Map(conflict.choices.map(each => [same(each.value), each.value])).values()];
    out.push(item('which', {topic: conflict.topic}, {question: `${conflict.topic.replace(/^./, letter => letter.toUpperCase())}: which is right?`, format: choice(values),
      hint: conflict.choices.map(each => `${each.value} on your ${PAGES[each.page] || each.page}`).join(' · '), details: {where: HOME_NAMES[conflict.home]}}));
  }
  for (const entry of storage.settings().profileUnsure || []) {
    const lines = itemsOf(await outline(entry.page), entry.page);
    if (!lines.some(line => same(line.label) === same(entry.label) && same(line.value) === same(entry.value))) continue;
    out.push(item('where', {page: entry.page, label: entry.label, value: entry.value}, {question: 'Where does this line go?', format: choice([...Object.values(sections.SECTIONS), KEEP]),
      details: {where: PAGES[entry.page] || entry.page, line: entry.label ? `${entry.label}: ${entry.value}` : entry.value}}));
  }
  for (const [home, lines] of Object.entries(found)) {
    for (const line of lines) {
      const format = formatFor({marked: line.kind ? {kind: line.kind} : null, kept: kept[keyOf(line.label)]});
      if (asked(line.value)) out.push(item('open', {home, label: line.label}, {question: line.label, format, hint: hintOf(line.value), details: {where: HOME_NAMES[home]}}));
      else if (needsCheck(format.kind, line.value)) out.push(item('check', {home, label: line.label, kind: format.kind}, {question: `${line.label}: make it exact`, format, value: line.value, details: {where: HOME_NAMES[home]}}));
    }
  }
  const owned = ownedElsewhere(outlines.profile);
  const asks = itemsOf(outlines.profile, 'profile', {withOpen: true})
    .filter(each => each.open && /\p{L}/u.test(each.label) && !each.label.includes('❓') && !owned.has(each.id.slice('profile:'.length)) && isAsk(each.label, each.key));
  for (const each of asks) {
    out.push(item('open', {page: 'profile', label: each.label}, {question: each.label, format: formatFor({kept: kept[keyOf(each.label)]}), hint: hintOf(each.key), details: {where: PAGES.profile}}));
  }
  return out;
}

// A Your details line's value replaced (its kind and note kept); '' removes it. -> {ok, homeName, error}.
async function setLine(storage, home, label, value, {fetcher, save}) {
  const current = (await sections.read(storage, fetcher))[home] || [];
  await save(storage, home, current.map(line => (same(line.label) === same(label) ? {...line, value} : line)).filter(line => String(line.value).trim()), fetcher);
  const back = (await sections.read(storage, fetcher))[home] || [];
  const ok = value ? back.some(line => same(line.label) === same(label) && same(line.value) === same(value)) : !back.some(line => same(line.label) === same(label));
  return ok ? {ok: true, homeName: HOME_NAMES[home]} : {ok: false, error: 'It did not save; nothing else changed'};
}

// A line of a page outside Your details, found again by its words: {page, block (the outline entry or table row), item}.
async function lineOn(storage, page, test, {fetcher}) {
  const opened = openStore(storage, {fetcher}), outline = await opened.page(page).outline();
  const found = itemsOf(outline, page, {withOpen: true}).find(each => !each.home && test(each));
  if (!found) return null;
  const id = found.id.slice(page.length + 1);
  const block = outline.find(entry => entry.id === id) || outline.filter(entry => entry.type === 'table').flatMap(entry => entry.rows).find(row => row.id === id);
  return {page: opened.page(page), block, item: found, table: Boolean(block?.cells)};
}

// The person's answer to one item. value: the picked value (which), a section's heading or KEEP (where), the exact value (check), the answer (open; '' = no answer kept).
export async function answer(storage, key, value, {fetcher, ai = {}, save = sections.save} = {}) {
  const {kind, ref} = parse(key), text = String(value ?? '').trim();
  if (kind === 'which') {
    const conflict = (storage.settings().profileConflicts || []).find(each => each.topic === ref.topic);
    const pick = conflict ? conflict.choices.findIndex(each => same(each.value) === same(text)) : -1;
    if (pick < 0) return {ok: false, error: 'Pick one of the values'};
    const done = await resolve(storage, ref.topic, pick, {fetcher, save});
    return done.ok ? {...done, homeName: HOME_NAMES[conflict.home]} : done;
  }
  if (kind === 'where') {
    const mine = each => each.page === ref.page && same(each.label) === same(ref.label) && same(each.value) === same(ref.value);
    const drop = () => storage.saveSettings({profileUnsure: (storage.settings().profileUnsure || []).filter(each => !mine(each))});
    if (text === KEEP) { drop(); return {ok: true, homeName: `your ${PAGES[ref.page] || ref.page}`}; }
    const home = Object.keys(sections.SECTIONS).find(each => sections.SECTIONS[each] === text);
    if (!home) return {ok: false, error: 'Pick where it goes'};
    if (!await writeHome(storage, home, ref.label || ref.value, ref.value, fetcher, save)) return {ok: false, error: 'It did not save; nothing else changed'};
    const old = await lineOn(storage, ref.page, mine, {fetcher});
    if (old) await old.page.remove({id: old.block.id, text: old.item.check});
    drop();
    return {ok: true, homeName: HOME_NAMES[home]};
  }
  if (kind === 'check') return text && !needsCheck(ref.kind || '', text) ? setLine(storage, ref.home, ref.label, text, {fetcher, save}) : {ok: false, error: 'Pick the parts first'};
  if (kind === 'open' && ref.home) return setLine(storage, ref.home, ref.label, text, {fetcher, save});
  if (kind === 'open') {
    const line = await lineOn(storage, ref.page, each => each.open && same(each.label) === same(ref.label), {fetcher});
    if (!line) return {ok: false, error: 'Already answered'};
    const home = text ? await homeOf(ref.label, text, ai) : '';
    if (home && !await writeHome(storage, home, ref.label, text, fetcher, save)) return {ok: false, error: 'It did not save; nothing else changed'};
    if (!text || home) { await line.page.remove({id: line.block.id, text: line.item.check}); return {ok: true, ...(home ? {homeName: HOME_NAMES[home]} : {})}; }
    // Its home is this Profile line (owner, 18 Oct 2026: "answer onto that line").
    if (line.table) await line.page.setCell(line.block, 1, text.slice(0, 1900));
    else await line.page.setText(line.block, `${ref.label}: ${text}`);
    return {ok: true, homeName: 'your Profile'};
  }
  return {ok: false, error: 'That question is no longer open'};
}

// A Profile moved before "unsure" existed (owner, 18 Oct 2026: "Re-check the lines that stayed, once"): its answered lines outside Your details are
// judged once more and the unsure ones queued; nothing moves. No AI: tried again later. -> {queued}.
export async function recheck(storage, {fetcher, ai = {}, now = new Date()} = {}) {
  const settings = storage.settings();
  if (!settings.profileMovedAt || settings.profileUnsureAt || !(ai.client || ai.apiKey)) return {queued: 0};
  const opened = openStore(storage, {fetcher});
  const items = [];
  for (const page of ['profile', 'answers']) items.push(...itemsOf(await opened.page(page).outline(), page).filter(each => !each.home));
  const judged = await judge(items, ai);
  return {queued: keepUnsure(storage, items.filter(each => judged.get(each.id)?.home === 'unsure'), now)};
}
