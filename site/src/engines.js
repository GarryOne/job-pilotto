// Which AI an install runs on, read from its latest daily health report (the app's telemetry 'health' event carries aiEngine since 9 Oct 2026):
// the engine (api: Anthropic key, cli: Claude Code, openai: OpenAI key, codex: Codex) for the installs count, and its family (claude | openai)
// for every other metric (owner, 9 Oct 2026: a family's CLI and API run the same models, so metrics split by family; installs by engine to see
// plan vs API). An install with no health report, or none naming an engine: 'unknown'. Nothing new is sent by the app. Guarded by
// site/test/engines.test.js.
export const ENGINES = {api: 'Anthropic API key', cli: 'Claude Code (Claude plan)', openai: 'OpenAI API key', codex: 'Codex (ChatGPT plan)'};
export const FAMILIES = {claude: 'Claude', openai: 'OpenAI'};
export const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : engine === 'api' || engine === 'cli' ? 'claude' : 'unknown');
// The SQL of each install's latest engine, as a CTE body (install, engine).
export const LATEST_ENGINE = `SELECT t.install, json_extract(t.data, '$.aiEngine') AS engine FROM telemetry t
  WHERE t.kind = 'health' AND t.at = (SELECT MAX(at) FROM telemetry WHERE install = t.install AND kind = 'health')`;
// The same, as a family per install: join a per-install table on it and filter "WHERE fam.family = ?".
export const LATEST_FAMILY = `SELECT install, CASE WHEN engine IN ('openai', 'codex') THEN 'openai' WHEN engine IN ('api', 'cli') THEN 'claude'
  ELSE 'unknown' END AS family FROM (${LATEST_ENGINE})`;

// The family of one reporting install (raw install id, as telemetry stores it), for the counts a report adds.
export async function familyOfInstall(db, install) {
  try {   // never fails a report: no telemetry table or no health row yet -> 'unknown'
    const row = await db.prepare(`SELECT json_extract(data, '$.aiEngine') AS engine FROM telemetry WHERE install = ? AND kind = 'health' ORDER BY at DESC LIMIT 1`)
      .bind(String(install || '')).first();
    return familyOf(row?.engine);
  } catch {
    return 'unknown';
  }
}

// Installs seen since `from`, by engine (their latest health report): [{engine, label, family, n}], the four engines always listed.
export async function installsByEngine(db, from) {
  const rows = (await db.prepare(`WITH latest AS (${LATEST_ENGINE}) SELECT COALESCE(latest.engine, 'unknown') AS engine, COUNT(DISTINCT t.install) AS n
    FROM telemetry t LEFT JOIN latest ON latest.install = t.install WHERE t.day >= ? GROUP BY 1`).bind(from).all()).results || [];
  const count = engine => rows.filter(row => (ENGINES[row.engine] ? row.engine : 'unknown') === engine).reduce((sum, row) => sum + (row.n || 0), 0);
  return [...Object.keys(ENGINES), 'unknown'].map(engine => ({engine, label: ENGINES[engine] || 'Not reported yet', family: familyOf(engine), n: count(engine)}));
}

// ?family=claude|openai on an admin page: the filter, or '' for all.
export const familyParam = url => (['claude', 'openai'].includes(url.searchParams.get('family')) ? url.searchParams.get('family') : '');
// The All | Claude | OpenAI links at the top of an admin page.
export function familyLinks(url, chosen) {
  const link = (value, label) => {
    const target = new URL(url); value ? target.searchParams.set('family', value) : target.searchParams.delete('family');
    return value === chosen ? `<strong>${label}</strong>` : `<a href="${target.pathname}${target.search}">${label}</a>`;
  };
  return `<p class="muted">AI family: ${[link('', 'All'), link('claude', 'Claude'), link('openai', 'OpenAI')].join(' · ')}</p>`;
}
