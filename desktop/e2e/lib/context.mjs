/* global document */
// Everything a suite needs, built once: its own Notion test page (token per suite), the fixture feeds (a copy a step can change), the slow-AI proxy, and the
// launched app. A suite is a short file in suites/ that calls ctx.run(...) with its steps. See README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startAiProxy} from './ai-proxy.mjs';
import {copyExtension, freePort, makeOpenShim} from './extension.mjs';
import {startForms} from './forms.mjs';
import {createVariation} from './variation.mjs';
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

// browser: the suite drives a real Chromium with the extension (lib/extension.mjs): the fixture forms are served, and the app's `open` reaches that browser.
export async function openContext(suite, {fresh = false, env: suiteEnv = {}, browser = false, light = false} = {}) {
  const key = KEY(), token = light ? '' : notionToken(suite);
  let session = null;
  const runner = createRunner(() => session);
  // A light suite needs only the AI key: no Notion page, no app, no browser (a model-only eval).
  if (light) return {suite, key, runner, run: runner.run, ARTIFACTS, E2E, needs: [{name: 'E2E_ANTHROPIC_KEY', value: key}], skipAll: !key, close: async () => {}};
  const ctx = {suite, key, token, runner, run: runner.run, ARTIFACTS, E2E, cv: process.env.E2E_CV || path.join(E2E, 'fixtures', 'cv.pdf'),
    needs: [{name: `E2E_ANTHROPIC_KEY`, value: key}, {name: `a Notion token for the ${suite} suite (E2E_NOTION_TOKEN${suite === 'wizard' ? '' : `_${suite.toUpperCase()}`})`, value: token}]};
  if (!key || !token) { ctx.skipAll = true; return ctx; }
  ctx.root = await testRoot(token);   // refuses any workspace but the test one, and any token that sees more than one page
  if (fresh) console.log(`Notion test page "${ctx.root.title}": ${await clearRoot(token, ctx.root.id)} item(s) moved to the trash`);
  ctx.built = !fresh && await workspaceReady(token);
  ctx.feeds = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-feeds-'));
  fs.cpSync(path.join(E2E, 'fixtures', 'feeds'), ctx.feeds, {recursive: true});
  ctx.proxy = await startAiProxy({delayMs: 0});
  ctx.vary = createVariation();   // no E2E_SEED = the fixed path (the release gate); a seed = this run's varied data and timing (every suite: lib/feeds.mjs, lib/forms.mjs)
  const browserEnv = {};
  if (browser) {
    // The app and the extension copy share a free port, so the test never meets the user's own app on 47111.
    ctx.appPort = await freePort();
    ctx.extensionDir = copyExtension(ctx.appPort);
    ctx.forms = await startForms({vary: ctx.vary});
    ctx.shim = makeOpenShim();
    Object.assign(browserEnv, {PATH: `${ctx.shim.bin}${path.delimiter}${process.env.PATH}`, JOB_PILOTTO_E2E_OPEN_DIR: ctx.shim.spool, JOB_PILOTTO_PORT: String(ctx.appPort)});
    if (process.platform === 'win32') browserEnv.JOB_PILOTTO_E2E_OPENER = ctx.shim.script;   // no `open` on Windows (lib/apply.js chromeCommand)
  }
  const env = {JOB_PILOTTO_MODEL_OVERRIDE: 'claude-haiku-4-5', JOB_PILOTTO_FIXTURE_DIR: ctx.feeds, JOB_PILOTTO_E2E_AI_BASE_URL: ctx.proxy.url, ...browserEnv, ...suiteEnv};
  const adopt = started => { session = started; ctx.session = session; ctx.page = session.page; ctx.app = session.app; ctx.profile = session.profile; };
  adopt(await launch({env}));
  ctx.close = async () => { await session?.shot('last'); await ctx.browser?.close(); await session?.close(); await ctx.proxy?.close(); await ctx.forms?.close(); };
  // Quit the app the hard way (as a crash or a power cut would: nothing gets to tidy up) and start it again on the same profile. `extra` adds to the environment; `between(profile)` runs while the app is down.
  ctx.relaunch = async (extra = {}, between) => { const profile = session.profile; await session.close(); await between?.(profile); adopt(await launch({env: {...env, ...extra}, profile})); };
  ctx.expectStep = async (name, timeout = 20000) => {
    await ctx.page.waitForFunction(wanted => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step === wanted, name, {timeout})
      .catch(async () => { throw new Error(`expected the "${name}" step, the app shows "${await step(ctx.page)}"`); });
  };
  ctx.pickCv = () => pickFile(ctx.app, ctx.cv);
  return ctx;
}
