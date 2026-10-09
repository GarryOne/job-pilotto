/* global document, window */
// Everything a suite needs, built once: its own Notion test page (token per suite), the fixture feeds (a copy a step can change), the slow-AI proxy, and the
// launched app. A suite is a short file in suites/ that calls ctx.run(...) with its steps. See README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startAiProxy} from './ai-proxy.mjs';
import {farSide, startNotionProxy} from './notion-proxy.mjs';
import {startTelegramFake} from './telegram-fake.mjs';
import {startGoogleFake} from './google-fake.mjs';
import {startReleasesFake} from './releases-fake.mjs';
import {startNotionFake} from './notion-fake.mjs';
import {useNotionAt} from './notion.mjs';
import {appKey, appModelEnv, DUMMY_KEY, familyOf, isCi, keySecret, pickEngine, testKey} from './engine.mjs';
import {copyExtension, freePort, makeOpenShim} from './extension.mjs';
import {startForms} from './forms.mjs';
import {createVariation, placeOf} from './variation.mjs';
import {ARTIFACTS, E2E, launch, pickFile, step} from './app.mjs';
import {clearRoot, testRoot, workspaceReady} from './notion.mjs';
import {createRunner} from './runner.mjs';
import {pickStore, storeSettings} from './store.mjs';
import {tally} from './faults.mjs';

// A suite is a file in suites/ (adding one needs no other list). It may export `minutes` (its time limit in CI, default 15).
import {readdirSync} from 'node:fs';
export const SUITES = readdirSync(path.join(E2E, 'suites')).filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4)).sort();
const KEY = () => testKey();   // empty on a Mac, whatever the environment holds: the key is for CI (lib/engine.mjs)
// Each suite has its own Notion page and connection, so suites can run at the same time. E2E_NOTION_TOKEN is the wizard's; a suite without its own token falls
// back to it on a developer's Mac (one suite at a time), and is skipped in CI.
export function notionToken(suite) {
  const own = process.env[`E2E_NOTION_TOKEN_${suite.toUpperCase()}`] || '';
  if (suite === 'wizard') return process.env.E2E_NOTION_TOKEN_WIZARD || process.env.E2E_NOTION_TOKEN || '';
  if (own) return own;
  return process.env.CI ? '' : process.env.E2E_NOTION_TOKEN || '';
}

// browser: the suite drives a real Chromium with the extension (lib/extension.mjs): the fixture forms are served, and the app's `open` reaches that browser.
// engine: a suite whose steps the AI proxy answers pins 'api' (a placeholder key on a Mac); otherwise a Mac uses Claude Code, CI the API key (lib/engine.mjs).
export async function openContext(suite, {fresh = false, env: suiteEnv = {}, browser = false, light = false, notionProxy = false, telegram = false, google = false, releases = false, notion: usesNotion = true, notionStandIn = false, store: suiteStore = '', notionTokenOf = '', keepGoing = false, variesPlace = false, engine: suiteEngine = '', budgetMinutes = 0, stepNeeds = {}, report = null} = {}) {
  // Where the app keeps the person's data (lib/store.mjs): this Mac (sqlite, no Notion at all), the in-memory Notion (fresh and private for this run, no
  // token, no shared page: lib/notion-fake.mjs), or the real test workspace for a suite that pins it. A suite with no Notion part keeps its own setup.
  const store = light || !usesNotion ? '' : pickStore({suiteStore: suiteStore || (notionStandIn ? 'standin' : '')});
  if (store) console.log(`  store under test: ${store}${isCi() && !suiteStore && !notionStandIn ? ` (CI run ${process.env.GITHUB_RUN_NUMBER || '?'}: runs 0,1 sqlite, 2,3 stand-in, by 4)` : ''}`);
  const onNotion = usesNotion && store !== 'sqlite';
  const standIn = store === 'standin' ? await startNotionFake() : null;
  if (standIn) useNotionAt(standIn.url);
  const engine = pickEngine({suiteEngine});
  // The app's key follows its engine's family (E2E_OPENAI_KEY for OpenAI); a light suite is the judges' own calls: Claude's key.
  const key = light ? KEY() : testKey(process.env, engine), token = light ? '' : standIn ? 'stand-in' : notionToken(notionTokenOf || suite);
  if (!light) console.log(`  AI family under test: ${familyOf(engine) === 'openai' ? 'OpenAI' : 'Claude'} (engine ${engine}${isCi() ? `, CI run ${process.env.GITHUB_RUN_NUMBER || '?'}: odd runs OpenAI, even runs Claude` : ''})`);
  let session = null, fakes = [];   // the fake services of this suite, once started: the runner checks that a step's fault fired (lib/faults.mjs)
  const runner = createRunner(() => session, {keepGoing, stepNeeds, report, faultTally: () => tally(fakes), ...(budgetMinutes ? {budgetMs: budgetMinutes * 60000} : {})});
  // A light suite needs only the AI key: no Notion page, no app, no browser (a model-only eval).
  // The test's own judges and evals (lib/judge.mjs, fit.mjs, model.mjs, the explore agent) are Claude whatever the app runs on, so both families are judged
  // by one model: always the Anthropic test key, never the app's (9 Oct 2026: the first OpenAI run sent the OpenAI key to Anthropic, 401).
  const judgeKey = KEY();
  if (light) return {suite, key, judgeKey, engine, runner, run: runner.run, ARTIFACTS, E2E, needs: isCi() ? [{name: 'E2E_ANTHROPIC_KEY', value: key}] : [], skipAll: isCi() && !key, close: async () => {}};
  const ctx = {suite, key, judgeKey, token, runner, standIn, store, run: runner.run, ARTIFACTS, E2E, cv: process.env.E2E_CV || path.join(E2E, 'fixtures', 'cv.pdf'),
    engine, family: familyOf(engine), appKey: appKey(key), needsKey: isCi() ? [{name: keySecret(engine), value: key}] : [],   // CI only: on a Mac nothing needs a key
    needs: [...(['api', 'openai'].includes(engine) && isCi() ? [{name: keySecret(engine), value: key}] : []),
      // A suite with no Notion part (`export const notion = false`, the update flow) needs no Notion token and gets no page.
      ...(onNotion ? [{name: `a Notion token for the ${suite} suite (E2E_NOTION_TOKEN${suite === 'wizard' ? '' : `_${suite.toUpperCase()}`})`, value: token}] : [])]};
  if (ctx.needs.some(item => !item.value)) { ctx.skipAll = true; return ctx; }
  if (engine === 'cli') console.log('  AI engine: the Claude Code on this Mac (your plan): no Anthropic key is read or used on a Mac.');
  if (onNotion) ctx.root = await testRoot(token);   // refuses any workspace but the test one, and any token that sees more than one page
  if (fresh && ctx.root) console.log(`Notion test page "${ctx.root.title}": ${await clearRoot(token, ctx.root.id)} item(s) moved to the trash`);
  ctx.built = onNotion && !fresh && await workspaceReady(token);
  ctx.feeds = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-feeds-'));
  fs.cpSync(path.join(E2E, 'fixtures', 'feeds'), ctx.feeds, {recursive: true});
  ctx.proxy = await startAiProxy({delayMs: 0});
  // The OpenAI engine's calls (the app's and the engine's SDK follow OPENAI_BASE_URL in a test run): metered as app-openai, replayed like Claude's, and they obey
  // ctx.proxy's controls: a suite's stand-ins (setCanned), faults (setMode) and delay apply on an OpenAI turn too, in OpenAI's own shapes (lib/ai-proxy.mjs).
  ctx.openaiProxy = ctx.family === 'openai' ? await startAiProxy({target: 'https://api.openai.com', kind: 'app-openai', metered: /\/responses(\?|$)/, shape: 'openai', follow: ctx.proxy}) : null;
  // A suite that breaks Notion on purpose (`export const notionProxy = true`) gets the Notion stand-in between the app and Notion (lib/notion-proxy.mjs).
  if (notionProxy) ctx.notion = await startNotionProxy({target: farSide(standIn)});
  // A suite that reads what Telegram would receive (`export const telegram = true`) gets the fake Bot API (lib/telegram-fake.mjs); nothing reaches Telegram.
  if (telegram) ctx.telegram = await startTelegramFake();
  // A suite that runs the Gmail check (`export const google = true`) gets a fake Google with three of the mailreading eval's invented emails and a fake sign-in (lib/google-fake.mjs).
  // The update flow (`export const releases = true`): a fake GitHub release list the app's updater reads instead of GitHub (lib/releases-fake.mjs).
  if (releases) ctx.releases = await startReleasesFake();
  if (google) {
    const cases = JSON.parse(fs.readFileSync(path.join(E2E, '..', '..', 'tests', 'fixtures', 'mail_eval.json'), 'utf8')).cases;
    ctx.google = await startGoogleFake({emails: ['ats_thanks', 'interview_invite', 'security_code'].map(id => cases.find(item => item.id === id)?.email).filter(Boolean)});
  }
  fakes = [ctx.proxy, ctx.notion, ctx.telegram, ctx.google];
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
  const env = {...appModelEnv(), JOB_PILOTTO_FIXTURE_DIR: ctx.feeds, JOB_PILOTTO_E2E_AI_BASE_URL: ctx.proxy.url, ...(ctx.openaiProxy ? {JOB_PILOTTO_E2E_OPENAI_BASE_URL: `${ctx.openaiProxy.url}/v1`} : {}), ...(ctx.notion ? {JOB_PILOTTO_E2E_NOTION_BASE_URL: ctx.notion.url} : ctx.standIn ? {JOB_PILOTTO_E2E_NOTION_BASE_URL: ctx.standIn.url} : {}), ...(ctx.telegram ? {JOB_PILOTTO_E2E_TELEGRAM_BASE_URL: ctx.telegram.url} : {}),
    ...(ctx.releases ? {JOB_PILOTTO_E2E_UPDATES_URL: ctx.releases.url} : {}), ...(ctx.google ? {JOB_PILOTTO_E2E_GOOGLE_BASE_URL: ctx.google.url, GOOGLE_CLIENT_ID: 'e2e-client', GOOGLE_CLIENT_SECRET: 'e2e-secret', GOOGLE_REFRESH_TOKEN: 'e2e-refresh'} : {}), ...browserEnv, ...suiteEnv};
  // The environment the app was started with: a second app a step opens (another time zone, a fresh install) starts from it, so it talks to the same Notion
  // (real or the stand-in), AI proxy and fixtures (6 Oct 2026: calendar's second app had its own list and reached real Notion with the stand-in's token).
  ctx.appEnv = env;
  const adopt = started => { session = started; ctx.session = session; ctx.page = session.page; ctx.app = session.app; ctx.profile = session.profile; };
  // A seeded run of a suite that opts in lives somewhere else: another time zone (window and engine) and language (lib/variation.mjs placeOf).
  ctx.place = variesPlace ? placeOf() : null;
  if (ctx.place) { Object.assign(env, {TZ: ctx.place.zone, JOB_PILOTTO_TZ: ctx.place.zone, LANG: `${ctx.place.locale.replace('-', '_')}.UTF-8`}); console.log(`  place: ${ctx.place.zone}, ${ctx.place.locale}`); }
  adopt(await launch({env, lang: ctx.place?.locale || '', settings: storeSettings(store)}));
  // The app's trace is kept when the suite failed so far: a failed step, or an error outside the steps (lib/suite-main.mjs sets ctx.stopped first).
  const failed = () => !!ctx.stopped || runner.results.some(result => result.status === 'failed');
  ctx.close = async () => { await session?.shot('last'); await ctx.browser?.close(); await session?.close({keepTrace: failed()}); await ctx.proxy?.close(); await ctx.openaiProxy?.close(); await ctx.notion?.close(); await ctx.telegram?.close(); await ctx.google?.close(); await ctx.releases?.close(); if (ctx.standIn) { try { fs.writeFileSync(path.join(ARTIFACTS, 'notion-standin.json'), JSON.stringify(ctx.standIn.dump(), null, 1)); } catch {} await ctx.standIn.close(); } await ctx.forms?.close(); };
  // Quit the app the hard way (as a crash or a power cut would: nothing gets to tidy up) and start it again on the same profile. `extra` adds to the environment; `between(profile)` runs while the app is down.
  ctx.relaunch = async (extra = {}, between) => { const profile = session.profile; await session.close({keepTrace: failed()}); await between?.(profile); adopt(await launch({env: {...env, ...extra}, profile, lang: ctx.place?.locale || ''})); };
  ctx.expectStep = async (name, timeout = 20000) => {
    await ctx.page.waitForFunction(wanted => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step === wanted, name, {timeout})
      .catch(async () => { throw new Error(`expected the "${name}" step, the app shows "${await step(ctx.page)}"`); });
  };
  ctx.pickCv = () => pickFile(ctx.app, ctx.cv);
  // Run `fn` with the app on the API engine and the AI proxy in front of it, then put the engine back. With a dummy key (the default) nothing reaches Anthropic that the
  // proxy does not answer itself (429, 500, a delay then a refusal, a canned answer), so it costs nothing. There is no way to use the real key from here.
  ctx.withApi = async fn => {
    if (ctx.engine === 'api') return fn();
    const set = (mode, secret) => ctx.page.evaluate(async ({mode, secret}) => { if (secret) await window.pilot.saveSecret('ANTHROPIC_API_KEY', secret); await window.pilot.setAiEngine(mode); }, {mode, secret});
    await set('api', DUMMY_KEY);
    try { return await fn(); } finally { await set(ctx.engine, DUMMY_KEY); }   // back to the engine under test (Claude Code, Codex or the OpenAI key)
  };
  return ctx;
}
