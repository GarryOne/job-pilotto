// The fill mark on a tab's address, and which sessions' forms count as open (lib/form-tab.js). These were part of the extension's
// tab-pages tests before the extension moved to its own private repo.
import assert from 'node:assert/strict';
import {test} from 'node:test';

test('the fill mark goes on the tab\'s own address, once', async () => {
  const {markedUrl} = await import('../lib/form-tab.js');
  assert.equal(markedUrl('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=1'), 'https://job-boards.greenhouse.io/embed/job_app?for=n26&token=1#jobpilotto-fill');
  assert.equal(markedUrl('https://x.io/a#jobpilotto-fill'), '');
  assert.equal(markedUrl('chrome://extensions'), '');
});

test('a session\'s form counts as open only while a tab for it is reported (an embedded form included)', async () => {
  const {mergeTabs, withOpenForm} = await import('../lib/form-tab.js');
  const session = {id: 'a1', url: 'https://job-boards.greenhouse.io/n26/jobs/7768035', company: 'N26'};
  const embed = 'https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035';
  assert.deepEqual([...withOpenForm([session], mergeTabs([embed], []))], ['a1']);
  assert.deepEqual([...withOpenForm([session], mergeTabs([], []))], []);
  assert.deepEqual([...withOpenForm([session], mergeTabs(['https://jobs.lever.co/other/1'], []))], []);
});
