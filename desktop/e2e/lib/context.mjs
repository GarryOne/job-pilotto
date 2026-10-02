/* global document, window, getComputedStyle */
// Everything a suite needs, built once: its own Notion test page (token per suite), the fixture feeds (a copy a step can change), the slow-AI proxy, and the
// launched app. A suite is a short file in suites/ that calls ctx.run(...) with its steps. See README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startAiProxy} from './ai-proxy.mjs';
import {ARTIFACTS, E2E, launch, pickFile, step} from './app.mjs';
import {clearRoot, testRoot, workspaceReady} from './notion.mjs';
import {createRunner} from './runner.mjs';

// A suite is a file in suites/ (adding one needs no other list). It may export `minutes` (its time limit in CI, default 15).
import {readdirSync} from 'node:fs';
export const SUITES = readdirSync(path.join(E2E, 'suites')).filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4)).sort();
const KEY = () => process.env.E2E_ANTHROPIC_KEY || '';
// Each suite has its own Notion page and connection, so suites can run at the same time. E2E_NOTION_TOKEN is the wizard's; a suite without its own token falls
// back to it on a developer's Mac (one suite at a time), and is skipped in CI.
export function notionToken(suite) {
  const own = process.env[`E2E_NOTION_TOKEN_${suite.toUpperCase()}`] || '';
  if (suite === 'wizard') return process.env.E2E_NOTION_TOKEN_WIZARD || process.env.E2E_NOTION_TOKEN || '';
  if (own) return own;
  return process.env.CI ? '' : process.env.E2E_NOTION_TOKEN || '';
}

export async function openContext(suite, {fresh = false} = {}) {
  const key = KEY(), token = notionToken(suite);
  let session = null;
  const runner = createRunner(() => session);
  const ctx = {suite, key, token, runner, run: runner.run, ARTIFACTS, E2E, cv: process.env.E2E_CV || path.join(E2E, 'fixtures', 'cv.pdf'),
    needs: [{name: `E2E_ANTHROPIC_KEY`, value: key}, {name: `a Notion token for the ${suite} suite (E2E_NOTION_TOKEN${suite === 'wizard' ? '' : `_${suite.toUpperCase()}`})`, value: token}]};
  if (!key || !token) { ctx.skipAll = true; return ctx; }
  ctx.root = await testRoot(token);   // refuses any workspace but the test one, and any token that sees more than one page
  if (fresh) console.log(`Notion test page "${ctx.root.title}": ${await clearRoot(token, ctx.root.id)} item(s) moved to the trash`);
  ctx.built = !fresh && await workspaceReady(token);
  ctx.feeds = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-feeds-'));
  fs.cpSync(path.join(E2E, 'fixtures', 'feeds'), ctx.feeds, {recursive: true});
  ctx.proxy = await startAiProxy({delayMs: 0});
  session = await launch({env: {JOB_PILOTTO_MODEL_OVERRIDE: 'claude-haiku-4-5', JOB_PILOTTO_FIXTURE_DIR: ctx.feeds, JOB_PILOTTO_E2E_AI_BASE_URL: ctx.proxy.url}});
  ctx.session = session; ctx.page = session.page; ctx.app = session.app; ctx.profile = session.profile;
  ctx.close = async () => { await session?.shot('last'); await session?.close(); await ctx.proxy?.close(); };
  ctx.expectStep = async (name, timeout = 20000) => {
    await ctx.page.waitForFunction(wanted => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step === wanted, name, {timeout})
      .catch(async () => { throw new Error(`expected the "${name}" step, the app shows "${await step(ctx.page)}"`); });
  };
  ctx.pickCv = () => pickFile(ctx.app, ctx.cv);
  return ctx;
}
