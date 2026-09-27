import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleReport, sanitize } from '../src/report.js';

const report = { site: 'job-boards.greenhouse.io', version: '0.6.2', fields: [
  { label: 'Location (City)', type: 'combobox', required: true, reason: 'dropdown clicked, but no option matched', options: ['Geneva, Switzerland'] },
  { label: 'Pronouns', type: 'text', reason: 'no answer in the kit, Profile or your details' },
  { label: '<script>x</script>'.repeat(20), type: 'text', reason: 'answer given, but the field did not take it', value: 'secret' }] };

test('reports keep only mechanical failures, as form structure; no values, no markup', () => {
  const clean = sanitize(report);
  assert.equal(clean.fields.length, 2);  // the missing answer is a data gap, not a code bug
  assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.ok(!JSON.stringify(clean).includes('<'));
  assert.equal(sanitize({ site: 'not a host', fields: report.fields }), null);
});

test('only the owner\'s app (REPORT_TOKEN) is trusted; others go to triage', async () => {
  const calls = [];
  const dispatch = async (_env, inputs, workflow) => calls.push({ inputs, workflow });
  const post = (auth) => new Request('https://w/report/fill-failure', { method: 'POST', body: JSON.stringify(report),
    headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  assert.equal((await (await handleReport(post('t0k'), { REPORT_TOKEN: 't0k' }, dispatch)).json()).trusted, true);
  assert.equal((await (await handleReport(post('nope'), { REPORT_TOKEN: 't0k' }, dispatch)).json()).trusted, false);
  assert.equal(calls[0].workflow, 'fill-failure-intake.yml');
  assert.equal(calls[1].inputs.trusted, 'false');
});
