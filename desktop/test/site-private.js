// A test that reads files of the website, which lives in the private repo job-pilotto-site: it is skipped here and runs there, where its folders (web/, admin/, api/, shared/, workers/ …) are laid over this repo.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';

export const hasSite = existsSync(new URL('../../admin/', import.meta.url));
export const siteTest = hasSite ? test : (name, ...rest) => test.skip(`${name} (runs in job-pilotto-site)`, ...rest);

// The contract between the two repos is one way (owner, 21 Oct 2026): the site lands first and may know MORE than public lists; it must never know LESS.
// siteMissing / assertSiteAccepts are red only for what public lists or sends and the site lacks (order and extras on the site do not matter).
export const siteMissing = (publicList, siteList) => [...new Set(publicList)].filter(item => !new Set(siteList).has(item));
export const assertSiteAccepts = (publicList, siteList, what) =>
  assert.deepEqual(siteMissing(publicList, siteList), [], `${what}: public lists these and the site (on its main) does not accept them: land the site half first (docs/rules/private-site.md)`);
