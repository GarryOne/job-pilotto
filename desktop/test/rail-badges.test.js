// In the icon rail every nav badge and dot is a small marker inside its 48px button, above the icon, never over it (owner, 17 Oct 2026). Renders the demo app (electron); skipped in CI (no display) and where electron is not installed.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {badgeLabel} from '../renderer/badge-label.js';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const probe = `JSON.stringify((() => {
  document.querySelector('.app').classList.add('rail');
  const set = (id, text) => { const n = document.getElementById(id); n.hidden = false; n.textContent = text; };
  set('nav-jobs-badge', '99+'); set('nav-applying-badge', '6');
  document.querySelectorAll('.nav .nav-dot').forEach(d => { d.hidden = false; });
  document.querySelectorAll('#nav-reports, #nav-interviews, #nav-employers').forEach(n => { n.hidden = false; });
  const box = e => { const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom}; };
  return [...document.querySelectorAll('.nav')].filter(n => n.offsetParent).flatMap(n => [...n.querySelectorAll('.nav-badge:not([hidden]), .nav-dot:not([hidden])')]
    .map(mark => ({view: n.dataset.view, button: box(n), icon: box(n.querySelector('.icon')), mark: box(mark)})));
})())`;

test('badge counts are capped to fit the rail', () => {
  assert.deepEqual([6, 99, 100, 474].map(badgeLabel), ['6', '99', '99+', '99+']);
});

test('in the rail, each badge and dot sits inside its button and clear of the icon', {skip: process.env.CI || !existsSync(`${desktop}node_modules/.bin/electron`)}, () => {
  const run = spawnSync('node', ['scripts/shot.mjs', 'jobs', '--no-picture', '--eval', probe], {cwd: desktop, encoding: 'utf8', timeout: 90000});
  const marks = JSON.parse(JSON.parse(run.stdout.trim().split('\n').pop()));
  assert.ok(marks.length >= 6, `badges and dots found: ${marks.length}`);
  for (const {view, button, icon, mark} of marks) {
    assert.ok(mark.l >= button.l && mark.r <= button.r && mark.t >= button.t && mark.b <= button.b, `${view}: marker inside the button`);
    const overlaps = mark.l < icon.r && mark.r > icon.l && mark.t < icon.b && mark.b > icon.t;
    assert.ok(!overlaps, `${view}: marker clear of the icon`);
  }
});
