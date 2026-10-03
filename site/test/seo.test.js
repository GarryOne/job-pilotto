import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Google can find the public pages: robots, sitemap, canonical, structured data', () => {
  const robots = file('robots.txt');
  assert.match(robots, /Sitemap: https:\/\/www\.jobpilotto\.workers\.dev\/sitemap\.xml/);
  for (const path of ['/stats', '/telemetry', '/feedback', '/api/']) assert.match(robots, new RegExp(`Disallow: ${path}`));
  const sitemap = file('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/www\.jobpilotto\.workers\.dev\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobpilotto\.workers\.dev\/compare<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobpilotto\.workers\.dev\/intelligence<\/loc>/);
  assert.doesNotMatch(sitemap, /friends/);
  for (const [page, canonical] of [['index.html', '/'], ['compare.html', '/compare'], ['intelligence.html', '/intelligence']]) {
    const html = file(page);
    assert.ok(html.includes(`<link rel="canonical" href="https://www.jobpilotto.workers.dev${canonical}">`), page);
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta property="og:image"/);
    assert.ok(!/<title>Job Pilotto<\/title>/.test(html), `${page} needs a descriptive title`);
  }
  const ld = file('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.equal(JSON.parse(ld[1])['@type'], 'SoftwareApplication');
  assert.match(file('index.html'), /<meta name="google-site-verification" content="[\w-]{20,}">/);   // Search Console ownership: keep it, removing it un-verifies the site
  assert.match(file('friends.html'), /<meta name="robots" content="noindex">/);
});
