// The shared fake page (test/fake-fill-page.js) runs a whole fill: it fails here, by name, when the fill starts calling a page helper the fake does not stub.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fakeFillPage} from './fake-fill-page.js';

test('a whole fill runs on the fake page and returns its trace, with no stub added by the test', async () => {
  const rows = [{field: 'why', label: 'Why do you want this job?', type: 'textarea', required: true, filled: false, legal: false},
    {field: 'terms', label: 'I agree to the terms', type: 'checkbox', required: true, filled: false, legal: true}];
  const {fill} = fakeFillPage(rows);
  const summary = await fill([]);
  assert.deepEqual(summary.trace.map(row => [row.label, row.outcome, row.reason]),
    [['Why do you want this job?', 'left', 'no answer in the kit, Profile or your details'], ['I agree to the terms', 'left', 'legal/consent: always your choice'], ['CV', 'left', 'no CV in the app']]);   // no CV given: the fill says so
});
