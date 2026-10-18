// /admin/design: the design system page and its snapshot zip (spec: the owner's decision of 18 Oct 2026, "built from the repository, with a live site page").
// The files are built from the repository at deploy time (tools/design-system/build.mjs, run by .github/workflows/site.yml) into public/admin/design/, and the Worker
// runs first for that folder (wrangler.toml assets.run_worker_first) so only a signed-in admin gets them; anyone else gets the same 404 as any other admin page. No database, no key of its own.
import {viewer} from './auth.js';
import {NAV_STYLE, nav, question} from './admin.js';

const ROOT = '/admin/design';
const notFound = () => new Response('Not found', {status: 404});

export async function designView(request, env) {
  const who = await viewer(request, env);
  if (!who || !env.ASSETS) return notFound();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== ROOT && !path.startsWith(`${ROOT}/`)) return notFound();
  if (path.includes('..')) return notFound();
  const page = path === ROOT;
  const asset = await env.ASSETS.fetch(new Request(`${url.origin}${ROOT}/${page ? '' : path.slice(ROOT.length + 1)}`, {method: 'GET'}));
  if (!asset.ok) return notFound();
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex');
  if (path.endsWith('.zip')) headers.set('Content-Disposition', 'attachment; filename="job-pilotto-design-system.zip"');
  if (!page) return new Response(asset.body, {status: 200, headers});
  // The admin menu and its own style only: the shared page style (admin.js BASE_STYLE) would restyle the app's .card, main and h1 that this page shows as they really look.
  const html = (await asset.text()).replace('</head>', `<style>${NAV_STYLE}</style></head>`).replace(/<body([^>]*)>/, `<body$1>${nav(ROOT, who)}${question(ROOT)}`);
  return new Response(html, {status: 200, headers});
}
