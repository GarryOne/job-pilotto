// Does the model still read the Gmail check's emails right? (the AI half of src/ai/mail.py, which its unit tests stub.) Invented emails with a known right answer go
// to the real model through the check's own prompt (tools/mail_eval.py); no Gmail, no Notion, no app, no browser. It costs real AI money, so it runs ONLY when the
// reading changes (src/ai/mail.py, its cases, the script): never on a schedule, never in the nightly gate. A person can still start it by name.
import {execFile} from 'node:child_process';
import path from 'node:path';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {python, pythonEnv} from '../lib/python.mjs';

export const name = 'mailreading';
export const minutes = 5;
export const light = true;
export const cadence = 'watched';
export const watches = ['src/ai/mail.py', 'src/ai/mail_inbox.py', 'src/ai/mail_read.py', 'src/ai/mail_triage.py', 'tools/mail_eval.py', 'tests/fixtures/mail_eval.json'];   // the model's reading lives in these pieces of the mail check

const repo = path.resolve(import.meta.dirname, '..', '..', '..');

export async function run(ctx) {
  let report = null;
  await ctx.run('the model reads the invented emails through the check\'s own prompt', async () => {
    // On the API (CI) the eval's calls go through the AI proxy, so what it pays is counted for /ai-cost (lib/ai-meter.mjs).
    const proxy = ctx.engine === 'api' ? await startAiProxy() : null;
    try {
    report = await new Promise(resolve => execFile(python(), [path.join(repo, 'tools', 'mail_eval.py')], {
      cwd: repo, timeout: 4 * 60 * 1000, maxBuffer: 4 << 20,
      env: pythonEnv({ANTHROPIC_API_KEY: ctx.key, JOB_PILOTTO_AI_ENGINE: ctx.engine, ...(proxy ? {ANTHROPIC_BASE_URL: proxy.url} : {})}),
    }, (error, stdout, stderr) => resolve({code: error ? (error.code ?? 1) : 0, out: String(stdout), err: String(stderr)})));
    } finally { await proxy?.close(); }
    console.log(report.out.split('\n').filter(line => /^(ok|MISS)|right/.test(line)).map(line => `  ${line}`).join('\n'));
    if (!/\d+\/\d+ right/.test(report.out)) throw new Error(`the eval did not run: ${(report.err || report.out).trim().split('\n').slice(-3).join(' | ')}`);
  }, {needs: ctx.needs});
  await ctx.run('every email that must never be misread is read right: a rejection, an offer, an invitation, a security code, a receipt, a vendor alert', async () => {
    const strict = report.out.split('\n').filter(line => line.startsWith('MISS') && line.includes('[strict]'));
    if (strict.length) throw new Error(strict.map(line => line.replace(/\s+/g, ' ')).join('; '));
  }, {needs: ctx.needs});
  await ctx.run('and enough of the others are right (a model answers differently now and then, so a share, not all)', async () => {
    const share = /\((\d+)%, needs (\d+)%\)/.exec(report.out);
    if (!share) throw new Error('no score in the eval output');
    if (Number(share[1]) < Number(share[2])) throw new Error(`${share[1]}% right, needs ${share[2]}%: ${report.out.split('\n').filter(line => line.startsWith('MISS')).join('; ')}`);
  }, {needs: ctx.needs});
}
