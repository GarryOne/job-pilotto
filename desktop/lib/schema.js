// The user's Notion workspace, checked against config/notion_schema.json (the workspace as code, from
// tools/notion_schema.py): a missing column is added, a missing database or page is created next to the
// Profile page, so a workspace can always be rebuilt from scratch and never drifts from what the code needs.
// Runs when Notion is connected and at start-up. Nothing is ever deleted or renamed; views aren't in the API.
import fs from 'node:fs';
import path from 'node:path';
import {call} from './notion.js';
import {REPO} from './pipeline.js';

export function load(file = path.join(REPO, 'config', 'notion_schema.json')) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// A schema column -> the Notion API definition (relations need their target database's id).
export function apiProperty(column, targetId) {
  const {type} = column;
  if (type === 'select' || type === 'multi_select') return {[type]: {options: column.options || []}};
  if (type === 'number') return {number: {format: column.format || 'number'}};
  if (type === 'unique_id') return {unique_id: {prefix: null}};
  if (type === 'relation') return {relation: {database_id: targetId, ...(column.synced_property !== undefined
    ? {type: 'dual_property', dual_property: {}} : {type: 'single_property', single_property: {}})}};
  if (type === 'rollup') return {rollup: {relation_property_name: column.relation, rollup_property_name: column.property, function: column.function}};
  if (type === 'formula') return {formula: {expression: column.expression}};
  return {[type]: {}};
}
const PASSES = [type => !['relation', 'rollup', 'formula'].includes(type), type => type === 'relation', type => type === 'rollup', type => type === 'formula'];

// -> {ids (with anything created), created: [titles], columns: ["Database: Column"]}
export async function repair(token, ids, schema = load(), fetcher) {
  if (!schema || !ids.NOTION_PROFILE_PAGE_ID) return {ids, created: [], columns: []};
  const api = (method, route, body) => call(token, method, route, body, fetcher);
  const out = {ids: {...ids}, created: [], columns: []};
  let root;
  const parent = async () => {
    root ||= (await api('GET', `pages/${ids.NOTION_PROFILE_PAGE_ID}`)).parent?.page_id;
    if (!root) throw new Error('The Profile page has no parent page to create the missing parts in');
    return root;
  };

  // Databases the workspace lacks: created with their plain columns (the rest follow in the passes below).
  const have = {};
  for (const [env, db] of Object.entries(schema.databases)) {
    if (out.ids[env]) {
      have[env] = new Set(Object.keys((await api('GET', `databases/${out.ids[env]}`)).properties || {}));
      continue;
    }
    const properties = Object.fromEntries(Object.entries(db.columns).filter(([, c]) => PASSES[0](c.type)).map(([name, c]) => [name, apiProperty(c)]));
    const made = await api('POST', 'databases', {parent: {page_id: await parent()}, title: [{text: {content: db.title}}],
      ...(db.icon ? {icon: {type: 'emoji', emoji: db.icon}} : {}), ...(db.description ? {description: [{text: {content: db.description}}]} : {}),
      properties});
    out.ids[env] = made.id.replace(/-/g, '');
    have[env] = new Set(Object.keys(properties));
    out.created.push(db.title);
  }

  // Missing columns, in dependency order: plain, relations, rollups, formulas.
  for (const pass of PASSES) {
    for (const [env, db] of Object.entries(schema.databases)) {
      for (const [name, column] of Object.entries(db.columns)) {
        if (!pass(column.type) || have[env].has(name) || column.type === 'title') continue;
        if (column.type === 'relation') {
          const target = out.ids[column.database];
          if (!target) continue;
          const before = column.synced_property ? new Set(Object.keys((await api('GET', `databases/${target}`)).properties || {})) : null;
          await api('PATCH', `databases/${out.ids[env]}`, {properties: {[name]: apiProperty(column, target)}});
          if (before) {  // two-way: Notion names the other side itself; give it the schema's name
            const after = Object.keys((await api('GET', `databases/${target}`)).properties || {});
            const synced = after.find(n => !before.has(n));
            if (synced && synced !== column.synced_property && !before.has(column.synced_property)) {
              await api('PATCH', `databases/${target}`, {properties: {[synced]: {name: column.synced_property}}});
            }
            have[column.database]?.add(column.synced_property);
          }
        } else {
          await api('PATCH', `databases/${out.ids[env]}`, {properties: {[name]: apiProperty(column)}});
        }
        have[env].add(name);
        out.columns.push(`${db.title}: ${name}`);
      }
    }
  }

  // Pages the code reads (the app's own pages, like Search settings, are made by their modules).
  for (const [env, page] of Object.entries(schema.pages)) {
    if (out.ids[env] || page.made_by) continue;
    const made = await api('POST', 'pages', {parent: {page_id: await parent()}, icon: {type: 'emoji', emoji: page.emoji},
      properties: {title: {title: [{text: {content: page.title}}]}},
      children: [{object: 'block', type: 'paragraph', paragraph: {rich_text: [{type: 'text', text: {content: 'Filled in by Job Pilotto.'}}]}}]});
    out.ids[env] = made.id.replace(/-/g, '');
    out.created.push(page.title);
  }
  return out;
}
