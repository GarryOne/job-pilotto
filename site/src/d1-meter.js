// Who spends the D1 budget (11 Oct 2026: the free plan's daily limit was hit and Cloudflare could not say which route or caller read the rows). meter() wraps env.STATS for ONE request and adds
// up the rows_read / rows_written D1 reports for each query; requestLine() is the one JSON log line per request (route, caller kind, rows). No D1 read or write of its own. Guard: test/d1-meter.test.js.
export const newTally = () => ({queries: 0, read: 0, written: 0, unmetered: 0});

// A D1 database whose statements add to `tally`. first() and raw() return no meta, so they count as a query with unmetered rows.
export function meter(db, tally) {
  if (!db) return db;
  const real = new WeakMap();   // a wrapped statement -> the statement D1 gave: batch() needs the real ones
  const note = result => { const meta = result?.meta; tally.queries += 1; if (meta) { tally.read += meta.rows_read ?? 0; tally.written += meta.rows_written ?? 0; } else tally.unmetered += 1; return result; };
  const wrap = statement => {
    const proxy = new Proxy(statement, {get(target, prop) {
      if (prop === 'bind') return (...args) => wrap(target.bind(...args));
      if (prop === 'run' || prop === 'all') return async (...args) => note(await target[prop](...args));
      if (prop === 'first' || prop === 'raw') return async (...args) => { const out = await target[prop](...args); tally.queries += 1; tally.unmetered += 1; return out; };
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    real.set(proxy, statement);
    return proxy;
  };
  return new Proxy(db, {get(target, prop) {
    if (prop === 'prepare') return sql => wrap(target.prepare(sql));
    if (prop === 'batch' && typeof target.batch === 'function') return async statements => { const results = await target.batch(statements.map(item => real.get(item) ?? item)); for (const result of results || []) note(result); return results; };
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}

// The route as a fixed-shape word: at most four segments, anything that looks like an id or a token becomes ":x".
export const routeOf = pathname => String(pathname || '/').split('/').slice(0, 5).map(part => (/^[A-Za-z0-9._-]{0,32}$/.test(part) && !/\d{4,}/.test(part) ? part : ':x')).join('/') || '/';

// Who called: the X-Caller word our own scripts and pages send (fixed pattern), else the kind of client from the user agent.
export function callerOf(request) {
  const tag = request.headers.get('x-caller') || '';
  if (/^[a-z0-9-]{1,32}$/.test(tag)) return tag;
  const agent = request.headers.get('user-agent') || '';
  return /^Mozilla\//.test(agent) ? 'browser' : /^curl\//.test(agent) ? 'curl' : /^(node|undici)/i.test(agent) ? 'node' : agent ? 'other' : 'none';
}

// One line per request that touched D1 (or failed): {kind: 'req', route, method, status, caller, host, queries, rows_read, rows_written, unmetered}. Logged as JSON so Workers Logs can filter and add it up.
export function requestLine(request, status, tally) {
  if (!tally.queries && status < 500) return null;
  const url = new URL(request.url);
  return JSON.stringify({kind: 'req', route: routeOf(url.pathname), method: request.method, status, caller: callerOf(request), host: url.hostname, queries: tally.queries, rows_read: tally.read, rows_written: tally.written, unmetered: tally.unmetered});
}
