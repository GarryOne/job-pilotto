// The "where to look" rectangle of npm run shot --mark '<css>': the page-side steps that draw a visible frame around every element a selector matches, so a PR's before and after shots point at the change.
// Used by scripts/shot.mjs; guard: test/shot-mark.test.js (draws it on a tiny page and reads the pixels).
export const MARK_COLOR = 'var(--bad, #b3261e)';   // tokens.css --bad: red, unlike the app's orange actions
export const MARK_WIDTH = 3;
export const MARK_PAD = 4;

// Steps for the window: scroll the first match into view, then one fixed, click-through frame per match. A selector with no match throws, so a typo never gives a shot with no mark.
export function markSteps(selectors) {
  return `{ const selectors = ${JSON.stringify(selectors)};
  for (const selector of selectors) {
    const nodes = [...document.querySelectorAll(selector)].filter(n => n.getBoundingClientRect().width);
    if (!nodes.length) throw new Error('shot --mark: no element matches ' + selector);
    nodes[0].scrollIntoView({block: 'nearest'});
    for (const node of nodes) {
      const r = node.getBoundingClientRect(), box = document.createElement('div');
      box.className = 'shot-mark';
      box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border-radius:6px;border:${MARK_WIDTH}px solid ${MARK_COLOR};' +
        'left:' + (r.left - ${MARK_PAD}) + 'px;top:' + (r.top - ${MARK_PAD}) + 'px;width:' + (r.width + 2 * ${MARK_PAD}) + 'px;height:' + (r.height + 2 * ${MARK_PAD}) + 'px';
      document.body.appendChild(box);
    }
  } }`;
}
