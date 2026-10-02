/* global document, window, getComputedStyle, location */
// The interaction probe: clicks the safe controls of the page that is showing and records what each click did (page change, calls the window made to the app, signs of work
// while it ran, errors thrown). A control that did nothing, an expandable that did not expand, an action that ran long with no sign of work and a click that threw are findings.
// Screenshots cannot show any of these; behaviour can.

const SLOW_MS = 500;       // an app call at least this long should show it is working
const MAX_CONTROLS = 40;

// What a probe must never press: it deletes, sends, signs in, leaves the app, or spends AI credit.
const UNSAFE_TEXT = /\b(delete|remove|quit|exit|sign\s?(in|out)|log\s?(in|out)|connect|disconnect|install|update|upgrade|apply|submit|send|record|import|replace|run|reset|clear|discard|stop|cancel|retry|start|generate|draft|scan|export|download|unlink|revoke|buy|pay|copy|open in|reveal|show in|check|refresh|rebuild|redo|find|search|review|score|prepare|sync|rescan|test)\b/i;
const UNSAFE_CLASS = /danger|destructive/i;

export function isSafe({text = '', cls = '', href = '', command = ''}) {
  if (command) return false;
  if (UNSAFE_TEXT.test(text) || UNSAFE_CLASS.test(cls)) return false;
  return !/^(https?:|mailto:)/i.test(href);
}

// What the click showed, in kinds of bug. `effects`: names of what changed on the page. `calls`: [{channel, ms}] the window made to the app during the click.
export function classify({view, control, effects, calls, loading = false, errors = []}) {
  const name = control.text || control.label;
  const make = (kind, detail) => ({view, severity: 'warning', kind, control: name, label: control.label, detail, source: 'interaction-probe'});
  const found = [];
  if (errors.length) found.push(make('console-error', `Clicking "${name}" threw: ${errors[0].slice(0, 200)}`));
  else if (control.expandable && !effects.includes('expanded toggled') && !effects.includes('control removed')) found.push(make('expand-broken', `"${name}" is an expandable control but clicking it did not expand or collapse anything`));
  else if (!effects.length && !calls.length) found.push(make('dead-control', `Clicking "${name}" did nothing: the page did not change and no call reached the app`));
  const slow = calls.filter(call => call.ms === null || call.ms >= SLOW_MS);
  if (slow.length && !loading && !errors.length) found.push(make('no-loading-state', `"${name}" ran for ${slow[0].ms === null ? 'more than the wait' : `${slow[0].ms} ms`} (${slow[0].channel}) and showed no sign of work: no disabled state, spinner or changed label`));
  return found;
}

// Runs in the page. Finds the visible, enabled controls under `scope`, tags each with data-probe, returns plain facts.
function discover({scope, max}) {
  const root = document.querySelector(scope) || document.body;
  const seen = [];
  for (const old of document.querySelectorAll('[data-probe]')) old.removeAttribute('data-probe');   // tags of an earlier page would match twice
  const visible = el => { const box = el.getBoundingClientRect(); const style = getComputedStyle(el); return box.width > 4 && box.height > 4 && style.visibility !== 'hidden' && style.display !== 'none'; };
  for (const el of root.querySelectorAll('button, [role="button"], summary, [aria-expanded], a[href^="#"]')) {
    if (seen.length >= max) break;
    if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true' || /(^|\s)(active|selected|current|on)(\s|$)/.test(String(el.className))) continue;   // the option already chosen: pressing it again rightly does nothing
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !visible(el) || el.closest('[hidden], nav, .sidebar')) continue;
    el.setAttribute('data-probe', String(seen.length));
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    seen.push({
      id: seen.length, text, cls: String(el.className || ''), href: el.getAttribute('href') || '', command: el.getAttribute('data-command') || '',
      label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`,
      expandable: el.hasAttribute('aria-expanded') || el.tagName === 'SUMMARY' || el.hasAttribute('aria-controls'),
    });
  }
  return seen;
}

// Runs in the page. What the page looks like now, for before/after.
function snapshot({id, scope}) {
  const root = document.querySelector(scope) || document.body;
  const el = document.querySelector(`[data-probe="${id}"]`);
  if (!el) return null;
  const structure = [];
  for (const node of document.body.querySelectorAll('*')) {
    if (node === el) continue;
    const bits = [node.tagName, node.hidden ? 'h' : '', node.getAttribute('aria-expanded') || '', node.getAttribute('aria-hidden') || '', node.open ? 'o' : '', node.disabled ? 'd' : '', node.getAttribute('data-state') || '', typeof node.className === 'string' ? node.className : ''];
    structure.push(bits.join('|'));
  }
  const target = el.getAttribute('aria-controls') ? document.getElementById(el.getAttribute('aria-controls')) : null;
  const details = el.closest('details');
  return {
    text: (document.body.innerText || '').length + ':' + (document.body.innerText || '').slice(0, 4000),
    structure: structure.join('\n'),
    hash: location.hash,
    expanded: [el.getAttribute('aria-expanded'), details ? details.open : null, target ? `${target.hidden}:${Math.round(target.getBoundingClientRect().height)}` : null].join('/'),
    busy: root.querySelectorAll('[aria-busy="true"], .spinner, .skeleton, [data-state="busy"], progress, [disabled]').length,
    own: `${el.disabled}|${el.getAttribute('aria-busy')}|${el.textContent}`,
    scroll: Math.round(window.scrollY),
  };
}

function effectsOf(before, after) {
  if (!after) return ['control removed'];
  const effects = [];
  if (before.text !== after.text) effects.push('text changed');
  if (before.structure !== after.structure) effects.push('structure changed');
  if (before.hash !== after.hash) effects.push('location changed');
  if (before.expanded !== after.expanded) effects.push('expanded toggled');
  if (before.own !== after.own) effects.push('control changed');
  return effects;
}

// A press can leave a dialog open that blocks the next press: Escape first, then close any dialog still open the way its own Close/Cancel would.
async function recover(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('#toasts .toast')) toast.remove();   // a toast over a control takes the next press
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      const close = [...dialog.querySelectorAll('button')].find(button => /^(cancel|close|not now|no|back|×|✕)\b/i.test(button.textContent.trim()) || button.getAttribute('aria-label') === 'Close');
      if (close) close.click(); else dialog.close();
    }
  }).catch(() => {});
}

const wait = ms => new Promise(done => setTimeout(done, ms));

// Click every safe control of the page showing now. `ipc`: {mark(): Promise<number>, since(mark): Promise<[{channel, ms, failed}]>}.
export async function probePage({page, view, ipc, scope = 'body', settleMs = 1500, max = MAX_CONTROLS, onFlag, reset}) {
  const errors = [];
  const onConsole = message => { if (message.type() === 'error') errors.push(message.text()); };
  const onPageError = error => errors.push(String(error.message || error));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const results = [], findings = [], skipped = [];
  try {
    const found = await page.evaluate(discover, {scope, max});
    const controls = found.filter(control => isSafe(control));
    skipped.push(...found.filter(control => !isSafe(control)).map(control => control.text || control.label));
    for (const control of controls) {
      // A page that drew itself again (or a dialog a press left open) loses the tags: go back to the page, find the control again by its words.
      if (!(await page.locator(`[data-probe="${control.id}"]`).isVisible().catch(() => false))) {
        if (reset) await reset();
        const again = (await page.evaluate(discover, {scope, max})).find(item => item.text === control.text && item.label === control.label);
        if (!again) { skipped.push(`${control.text || control.label} (gone)`); continue; }
        control.id = again.id;
      }
      const before = await page.evaluate(snapshot, {id: control.id, scope});
      if (!before) { skipped.push(`${control.text || control.label} (gone)`); continue; }
      errors.length = 0;
      const mark = await ipc.mark();
      const clickedAt = Date.now();
      const clicked = await page.locator(`[data-probe="${control.id}"]`).click({timeout: 2000, noWaitAfter: true}).then(() => '', error => String(error.message).split('\n').filter(line => /intercepts|obscur|not visible|not stable|outside|disabled/.test(line)).join(' ').trim() || 'timeout');
      if (clicked) { skipped.push(`${control.text || control.label} (${clicked.slice(0, 80)})`); continue; }
      let loading = false, after = null, calls = [];
      const started = Date.now();
      while (Date.now() - started < settleMs) {
        await wait(100);
        after = await page.evaluate(snapshot, {id: control.id, scope});
        calls = (await ipc.since(mark)).filter(call => call.start >= clickedAt - 50 && call.start <= clickedAt + 500);   // a poll that happened to run meanwhile is not this click's
        if (after && (after.busy > before.busy || after.own !== before.own)) loading = true;
        const running = calls.some(call => call.ms === null);
        if (running && after && effectsOf(before, after).length) loading = true;   // the page said something while the call was still running ("updating…")
        if (!running && Date.now() - started >= 300 && (calls.length || effectsOf(before, after).length)) break;
      }
      const effects = effectsOf(before, after);
      const result = {view, control: control.text || control.label, label: control.label, effects, calls: calls.map(call => ({channel: call.channel, ms: call.ms})), loading, errors: [...errors]};
      results.push(result);
      const flagged = classify({view, control, effects, calls: result.calls, loading, errors: result.errors});
      if (flagged.length && onFlag) await onFlag(control, flagged);
      findings.push(...flagged);
      await recover(page);
    }
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  return {results, findings, skipped};
}
