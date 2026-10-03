// lib/cv-look.js: from where a CV PDF puts its images and words to what the tailored CV must draw (photo, icons, logos, page breaks).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {apply, plan} from '../lib/cv-look.js';

const image = (id, x, y, w, h) => ({id, x, y, w, h});
const word = (str, x, y, w = 40, h = 8) => ({str, x, y, w, h});
const cv = {name: 'Ada', links: [{text: '+40 770 520 118', href: 'tel:1'}, {text: 'linkedin.com/in/ada', href: 'https://x'}, {text: 'ada@example.com', href: 'mailto:a'}, {text: 'github.com/ada', href: 'https://g'}],
  jobs: [{company: 'Acme', roles: []}, {company: 'Beta', roles: []}, {company: 'Gamma', roles: []}]};
// A4 in points, top left origin. Header links sit in two columns of two (reading order: phone, linkedin, email, github).
const pages = [
  {n: 1, width: 595, height: 842, images: [image('p', 536, 12, 39, 39), image('p2', 536, 12, 39, 39), image('i1', 20, 70, 15, 15), image('i2', 185, 90, 15, 15),
      image('l1', 20, 200, 50, 17), image('l2', 20, 400, 18, 18), image('b', 0, 672, 595, 198)],
    text: [word('Ada', 20, 30), word('+40 770 520 118', 40, 72), word('linkedin.com/in/ada', 205, 72), word('ada@example.com', 40, 92), word('github.com/ada', 205, 92),
      word('Summary', 20, 130), word('Acme', 540, 204), word('Production Engineer', 49, 204, 100), word('Beta', 540, 404)]},
  {n: 2, width: 595, height: 842, images: [image('l3', 50, 100, 18, 18)], text: [word('Gamma', 520, 104), word('Title', 79, 104)]},
];

test('the photo, the banner and each icon are found, in the size and gap the original uses', () => {
  const found = plan(pages, cv);
  assert.deepEqual([found.photo.x, found.photo.page], [536, 1]);
  assert.equal(found.banner.w, 595);
  assert.equal(found.pages[0].banner, true);
  assert.equal(found.icons.length, 4);
  const linkedin = found.icons.find(icon => icon.link === 1);
  assert.equal(linkedin.w, 15);                         // the size of the raster icons
  assert.ok(Math.abs(linkedin.x - 185) < 1.5, 'the icon sits where the original puts it, left of its text');
});

test('links come in the original\'s column order, so the template\'s grid fills each column down', () => {
  assert.deepEqual(plan(pages, cv).linkOrder, [0, 2, 1, 3]);
});

test('each employer gets its page and the logo level with its name; a logo set in from the margin indents its page', () => {
  const found = plan(pages, cv);
  assert.deepEqual(found.jobPages, [0, 0, 1]);
  assert.deepEqual(found.logos.map(logo => [logo.job, logo.page]), [[0, 1], [1, 1], [2, 2]]);
  assert.equal(found.pages[1].indent, 30);
  assert.equal(found.pages[0].indent, undefined);
});

test('a logo the CV clips to its mark keeps only the part before the title starts', () => {
  const clipped = plan(pages, cv).logos.find(logo => logo.job === 0);
  assert.ok(clipped.fraction < 0.6 && clipped.fraction > 0.4, `kept ${clipped.fraction} of a 50 pt logo whose title starts 29 pt in`);
});

test('nothing is guessed: an employer whose name is not on the pages leaves out the layout and the logos', () => {
  const found = plan(pages, {...cv, jobs: [...cv.jobs, {company: 'Nowhere', roles: []}]});
  assert.equal(found.jobPages, undefined);
  assert.deepEqual(found.logos, []);
});

test('a CV with no images stays as it is', async () => {
  const bare = [{n: 1, width: 595, height: 842, images: [], text: [word('Ada', 20, 30), word('Summary', 20, 130), word('Acme', 540, 204)]}];
  const found = plan(bare, {name: 'Ada', links: [], jobs: [{company: 'Acme', roles: []}]});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-look-'));
  const out = await apply(dir, {name: 'Ada', links: [], jobs: [{company: 'Acme', roles: []}]}, found, {});
  assert.equal(out.look, undefined);
  assert.equal(out.photo, undefined);
});

test('apply writes the pictures and records them in the CV data', async () => {
  const found = plan(pages, cv);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-look-'));
  const png = Buffer.from('PNG').toString('base64');
  const asked = [];
  const probe = {image: async (page, ids, fraction) => { asked.push(['image', ids.join('+'), fraction]); return {png}; }, crop: async () => ({png})};
  const out = await apply(dir, cv, found, probe);
  assert.equal(out.look, 'rich');
  assert.equal(out.photo, 'photo.png');
  assert.deepEqual(out.links.map(link => link.text), ['+40 770 520 118', 'ada@example.com', 'linkedin.com/in/ada', 'github.com/ada']);
  assert.ok(out.links.every(link => link.icon), 'every link has its icon');
  assert.deepEqual(out.jobs.map(job => [job.logo, job.page]), [['logo-0.png', 0], ['logo-1.png', 0], ['logo-2.png', 1]]);
  assert.deepEqual(out.layout.pages, [{class: 'first', banner: 'banner.png'}, {indent: 30}]);
  assert.ok(asked.some(([, ids]) => ids === 'p+p2'), 'an image and its mask are drawn together');
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'photo.png')));
});
