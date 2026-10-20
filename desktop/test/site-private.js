// A test that reads files of the website, which lives in the private repo job-pilotto-site: it is skipped here and runs there, where site/ is laid over this repo.
import {existsSync} from 'node:fs';
import {test} from 'node:test';

export const hasSite = existsSync(new URL('../../site/', import.meta.url));
export const siteTest = hasSite ? test : (name, ...rest) => test.skip(`${name} (runs in job-pilotto-site)`, ...rest);
