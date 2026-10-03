/* global window, document */
// Accessibility, checked by axe-core on every page the journey photographs: missing names on controls, contrast too low to read, a form field with no label.
// Only "serious" and "critical" violations count. One finding per RULE (view "a11y"), listing the pages where it occurs, so a shared cause is one issue,
// not one per page. Runs through page.evaluate, which the window's content-security policy does not block.
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
let source = null;
const axeSource = () => (source ??= fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));

// -> [{rule, impact, help, nodes, example}] for one page; [] when axe cannot run (it must never fail a journey).
export async function checkA11y(page) {
  try {
    if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axeSource());
    return await page.evaluate(async () => {
      const result = await window.axe.run(document, {resultTypes: ['violations'], runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa']}});
      return result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
        .map(item => ({rule: item.id, impact: item.impact, help: item.help, nodes: item.nodes.length, example: (item.nodes[0]?.target || []).join(' ').slice(0, 100)}));
    });
  } catch { return []; }
}

// Adds one page's violations to the suite's tally (ctx.a11y: rule -> {help, pages, nodes, example}).
export function tally(store, page, violations) {
  store.checked = (store.checked || 0) + 1;
  store.rules ??= {};
  for (const item of violations) {
    const rule = (store.rules[item.rule] ??= {help: item.help, impact: item.impact, pages: [], nodes: 0, example: item.example});
    if (!rule.pages.includes(page)) rule.pages.push(page);
    rule.nodes += item.nodes;
  }
  return store;
}

export function a11yFindings(store) {
  return Object.entries(store?.rules || {}).map(([rule, item]) => ({view: 'a11y', severity: 'warning', kind: 'a11y',
    detail: `${rule} on ${item.pages.slice(0, 6).join(', ')}${item.pages.length > 6 ? ` and ${item.pages.length - 6} more` : ''} (${item.nodes} element(s), ${item.impact}, e.g. ${item.example}): "${item.help}"`}));
}
