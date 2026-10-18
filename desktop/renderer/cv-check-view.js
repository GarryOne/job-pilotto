// Profile → CV: the CV check card (owner review fix 8, mockup 08, 18 Oct 2026). Two score rings (readability, content), the recommended fixes first with a
// priority chip and their fix behind "View details", then three folds (passed checks, score breakdown with what works and the missing terms, extracted
// text), then the two actions, each a row: its name, its button, its cost as a badge (live-card rows, owner 18 Oct 2026). The header says when and on which CV the result was made (a result belongs to one PDF: lib/cv-check.js
// drops it when the PDF changes). A folded card says "Mostly readable · 3 issues · 2 content suggestions". Moved here from pages/profile.js;
// model: cv-check-model.js. Guarded by test/cv-check-model.test.js and test/cv-check-view.test.js.
import {el} from './components.js';
import {reviewList, summaryTiles} from './page-parts.js';
import {icon} from './icons.js';
import {costLine, fixesOf, passedOf, scoreTone, summaryOf} from './cv-check-model.js';

const $ = id => document.getElementById(id);
const TONE = {high: 'bad', medium: 'warn', low: 'neutral'};
const LABEL = {high: 'High', medium: 'Medium', low: 'Low'};
let last = null;   // the result shown, with how a review would be paid now
export const lastCheck = () => last;

// The score tiles and the fixes are the shared page blocks (page-parts.js): a score is a ring filled to its value; a fix is a review item with its priority
// chip first and the concrete change and which check found it folded under "View details".
const scoreTiles = (ats, ai) => summaryTiles([
  {key: 'readability', label: 'Readability', score: ats.score, tone: scoreTone('readability', ats.score), note: 'How easily your CV can be read and parsed.'},
  ai ? {key: 'content', label: 'Content', score: ai.score, tone: scoreTone('content', ai.score), note: 'How well it presents your experience and skills.'}
    : {key: 'content', icon: 'file-text', label: 'Content', value: 'Not reviewed yet', note: 'Review CV content below.'}]);
function fixItem(fix, i) {
  const detail = el('div', 'cvc-fix-body');
  if (fix.suggestion) detail.append(el('span', 'cvc-fix', `Fix: ${fix.suggestion}`));
  detail.append(el('span', 'muted small', fix.from === 'content' ? 'From the content review' : 'From the readability check'));
  return {key: `${fix.from}-${i}`, title: fix.title, why: fix.issue, status: {text: LABEL[fix.priority], tone: TONE[fix.priority]}, detail};
}

function fold(glyph, title, count, children) {
  const box = el('details', 'cvc-fold');
  const head = el('summary');
  head.append(icon(glyph), el('b', '', title), ...(count === '' ? [] : [el('span', 'muted', `· ${count}`)]), icon('chevron', 'icon cvc-chevron'));
  box.append(head, ...children);
  return box;
}
const part = (title, text) => { const row = el('div', 'cvc-comp'); row.append(el('b', '', title), el('span', 'muted small', text)); return row; };

// data: lib/cv-check.js's saved result (or null) plus `billing`; cvName: the CV's file name, said in the header.
export function showCvCheck(data, {cvName = '', when = at => at} = {}) {
  last = data;
  const ats = data?.ats, ai = data?.ai, card = $('setting-cvcheck');
  card.dataset.summary = summaryOf(data);   // what the folded card says (profile-fold.js)
  $('cvc-state').textContent = ats ? `Checked ${when(data.at)} · ${cvName || 'current CV'}` : 'Not checked yet';
  $('cvc-state').classList.toggle('is-off', !ats);   // no green dot before a check
  $('cvc-scores').hidden = !ats;
  $('cvc-scores').replaceChildren(...(ats ? [scoreTiles(ats, ai)] : []));
  const fixes = fixesOf(data);
  $('cvc-fixes').hidden = !ats;
  $('cvc-fixes').replaceChildren(...(ats ? [el('h4', '', 'Recommended fixes'),
    reviewList(fixes.map(fixItem), {statusAt: 'first', rows: true, empty: 'Nothing to fix: every check passed.'})] : []));
  const folds = [];
  if (ats) {
    const passed = passedOf(data);
    if (passed.length) {
      const list = el('ul', 'cvc-checks');
      list.append(...passed.map(check => { const row = el('li', 'cvc-check is-pass'), body = el('div'); body.append(el('b', '', check.label), el('span', 'muted small', check.detail)); row.append(el('span', 'cvc-mark', '✓'), body); return row; }));
      folds.push(fold('check-circle', 'Passed checks', passed.length, [list]));
    }
    const parts = [part(`Readability · ${ats.score}`, `${ats.verdict} · ${ats.pages} page${ats.pages === 1 ? '' : 's'}`)];
    if (ai) {
      parts.push(...ai.components.map(item => part(`${item.name} · ${item.score}`, item.note)));
      if (ai.strengths.length) parts.push(part('Working well', ai.strengths.join(' · ')));
      if (ai.missing_keywords.length) parts.push(part('Terms the target roles ask for that the CV never states', `${ai.missing_keywords.join(', ')}. Add one only if it is true.`));
      if (ai.usd > 0 && ai.billing !== 'subscription') parts.push(part('Cost of this review', `$${ai.usd.toFixed(2)}`));
    }
    folds.push(fold('chart', 'Score breakdown', '', parts));
    const text = el('pre', 'cvc-pre', ats.text);
    folds.push(fold('file-text', 'Extracted text', '', [el('p', 'muted small', 'What a parser reads, in order.'), text]));
  }
  $('cvc-folds').hidden = !folds.length;
  $('cvc-folds').replaceChildren(...folds);
  $('cvc-ai-run').disabled = !ats;
  $('cvc-ai-run').title = ats ? '' : 'Check PDF readability first: the review reads what the parser read.';
  $('cvc-run-cost').textContent = costLine('readability');
  $('cvc-ai-cost').textContent = ats ? costLine('content', {billing: data?.billing, ai}) : 'Runs after the readability check';
}

// An action pressed: its label says what it does meanwhile, then the card is drawn from the answer. options(): showCvCheck's options plus say(text, tone),
// the page's message line (pages/core.js message, passed in so this file loads without the page).
export async function cvCheckAction(button, working, run, options) {
  const label = button.querySelector('span') || button, was = label.textContent;
  button.disabled = true;
  label.textContent = working;
  options().say('');
  const result = await run().catch(error => ({ok: false, error: error.message}));
  button.disabled = false;
  label.textContent = was;
  if (!result.ok) { options().say(result.error, 'error'); return; }
  showCvCheck(result, options());
}
