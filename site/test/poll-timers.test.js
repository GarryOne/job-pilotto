// Every admin page timer that fetches runs at most once a minute and stays quiet while the tab is hidden (11 Oct 2026: a page re-fetching every 15 s, with no hidden check, was the largest
// D1 reader of the day). Scans site/src for timers, meta refreshes and reloads, so a new faster or always-on one fails here.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';

const MIN_MS = 60000;
const files = readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js'));
const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('no page timer fires faster than once a minute, and every file with one checks document.hidden', () => {
  const found = [];
  for (const name of files) {
    const text = source(name);
    for (const match of text.matchAll(/set(?:Interval|Timeout)\((?:[^()]|\([^()]*\))*?,\s*([^;\n]*?)\)(?:;|\s*\/\/|\s*$)/gm)) {
      const delays = match[1].match(/\b\d{3,7}\b/g) || [];
      if (!/refresh|reload|poll|load/i.test(match[0])) continue;   // an animation or a "Copy" label timer, not a fetching one
      for (const delay of delays) found.push({name, delay: Number(delay), text: match[0].slice(0, 80)});
    }
    if (/http-equiv=.?refresh/.test(text)) found.push({name, delay: 0, text: 'meta refresh (cannot pause while hidden)'});
  }
  assert.ok(found.some(item => item.name === 'applying.js') && found.some(item => item.name === 'feedback.js'), 'the scan found no timer: it is blind');
  for (const item of found) {
    assert.ok(item.delay >= MIN_MS, `${item.name}: "${item.text}" fires every ${item.delay} ms (minimum ${MIN_MS})`);
    assert.match(source(item.name), /document\.hidden/, `${item.name}: a timer without a document.hidden check`);
  }
});
