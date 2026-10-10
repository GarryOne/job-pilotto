import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Google can find the public pages: robots, sitemap, canonical, structured data', () => {
  const robots = file('robots.txt');
  assert.match(robots, /Sitemap: https:\/\/www\.jobpilotto\.top\/sitemap\.xml/);
  for (const path of ['/stats', '/telemetry', '/feedback', '/api/']) assert.match(robots, new RegExp(`Disallow: ${path}`));
  const sitemap = file('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/www\.jobpilotto\.top\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobpilotto\.top\/compare<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobpilotto\.top\/intelligence<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobpilotto\.top\/platforms<\/loc>/);
  assert.doesNotMatch(sitemap, /friends/);
  for (const [page, canonical] of [['index.html', '/'], ['compare.html', '/compare'], ['intelligence.html', '/intelligence'], ['platforms.html', '/platforms']]) {
    const html = file(page);
    assert.ok(html.includes(`<link rel="canonical" href="https://www.jobpilotto.top${canonical}">`), page);
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta property="og:image"/);
    assert.ok(!/<title>Job Pilotto<\/title>/.test(html), `${page} needs a descriptive title`);
  }
  const ld = file('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.equal(JSON.parse(ld[1])['@type'], 'SoftwareApplication');
  assert.match(file('index.html'), /<meta name="google-site-verification" content="[\w-]{20,}">/);   // Search Console ownership: keep it, removing it un-verifies the site
  assert.match(file('friends.html'), /<meta name="robots" content="noindex">/);
});

test('the landing page links to the platform support page, which lists what is supported and what is coming', () => {
  assert.match(file('index.html'), /href="platforms\.html"/);
  const page = file('platforms.html');
  for (const word of ['Supported now', 'Next on the list', 'Under consideration', 'Microsoft Edge', 'Gmail', 'Outlook']) assert.ok(page.includes(word), word);
});
