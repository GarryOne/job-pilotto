// Every function the extension hands to chrome.scripting.executeScript (directly or through a run/press/inPage wrapper) is serialised from its own text and
// runs alone in the page: it may use nothing declared outside itself (a module const or helper there is a ReferenceError in the page, and the press quietly returns null).
// 16 Oct 2026: the sign-in press (account-fill.js) lost its tie-break that way; the closer look's hideValues had the same fault before. This reads the parsed source, so a
// future injected function that leans on an outside helper fails here by name, in unit tests, instead of in a live run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as acorn from 'acorn';
import * as eslintScope from 'eslint-scope';

const EXTENSION = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
const isFn = node => /Function/.test(node?.type || '');
const isExec = node => node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'executeScript';

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node)); else if (value && typeof value.type === 'string') walk(value, visit, node);
  }
}

// sources: {absolute path: text}. Returns [{file, label, outside: [names]}] for every injected function found.
export function injectedFunctions(sources) {
  const files = new Map();
  for (const [file, text] of Object.entries(sources)) {
    const ast = acorn.parse(text, {ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true});
    files.set(file, {ast, scope: eslintScope.analyze(ast, {ecmaVersion: 2022, sourceType: 'module'})});
  }
  const nameOf = (node, parent) => node.id?.name || (parent?.type === 'VariableDeclarator' ? parent.id.name : '');
  const handsOn = (body, names) => { let found = false; walk(body, inner => { if (inner.type === 'CallExpression' && inner.callee.type === 'Identifier' && names.has(inner.callee.name) && inner.arguments[names.get(inner.callee.name)]?.name === 'func') found = true; }); return found; };

  // wrappers: a function with a `func` parameter that gives it to executeScript, or to another wrapper (settled by repeating)
  const wrappers = new Map();
  for (const [file, {ast}] of files) {
    const names = new Map();
    wrappers.set(file, names);
    const register = (node, name) => {
      const at = node.params.findIndex(param => param.type === 'Identifier' && param.name === 'func');
      if (at < 0 || !name || names.has(name)) return;
      let direct = false;
      walk(node.body, inner => { if (isExec(inner) && inner.arguments.some(arg => arg.type === 'ObjectExpression' && arg.properties.some(prop => prop.key?.name === 'func' && (prop.shorthand || prop.value?.name === 'func')))) direct = true; });
      if (direct || handsOn(node.body, names)) names.set(name, at);
    };
    for (let round = 0; round < 3; round += 1) walk(ast, (node, parent) => {
      if (isFn(node)) register(node, nameOf(node, parent));
      if (node.type === 'VariableDeclarator' && node.init?.type === 'CallExpression') node.init.arguments.filter(isFn).forEach(arg => register(arg, node.id.name));   // page = bound('page', (func, args) => ...)
    });
  }

  const moduleOf = (file, source) => { const target = path.resolve(path.dirname(file), source); return files.has(target) ? target : null; };
  function resolve(file, name) {
    const variable = files.get(file).scope.scopes.find(item => item.type === 'module')?.set.get(name), def = variable?.defs[0];
    if (!def) return null;
    if (def.type === 'FunctionName') return {file, node: def.node};
    if (def.type === 'Variable' && isFn(def.node.init)) return {file, node: def.node.init};
    if (def.type === 'ImportBinding') {
      const target = moduleOf(file, def.parent.source.value);
      return target ? resolveExport(target, def.node.type === 'ImportSpecifier' ? def.node.imported.name : 'default') : null;
    }
    return null;
  }
  function resolveExport(file, name) {
    for (const node of files.get(file).ast.body) {
      if (node.type !== 'ExportNamedDeclaration') continue;
      if (node.declaration?.type === 'FunctionDeclaration' && node.declaration.id.name === name) return {file, node: node.declaration};
      for (const decl of node.declaration?.declarations || []) if (decl.id.name === name && isFn(decl.init)) return {file, node: decl.init};
      for (const spec of node.specifiers || []) if (spec.exported.name === name) return resolve(file, spec.local.name);
    }
    return null;
  }

  const found = new Map();
  for (const [file, {ast}] of files) {
    const names = wrappers.get(file);
    const add = (arg, label) => {
      if (isFn(arg)) found.set(`${file}:${arg.start}`, {file, node: arg, label: `${label} (line ${arg.loc.start.line})`});
      else if (arg?.type === 'Identifier') { const target = resolve(file, arg.name); if (target) found.set(`${target.file}:${target.node.start}`, {...target, label: arg.name}); }
    };
    walk(ast, node => {
      if (isExec(node)) node.arguments.filter(arg => arg.type === 'ObjectExpression').forEach(arg => arg.properties.filter(prop => prop.key?.name === 'func' && !prop.shorthand && prop.value?.name !== 'func').forEach(prop => add(prop.value, 'inline')));
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && names.has(node.callee.name)) add(node.arguments[names.get(node.callee.name)], 'inline');
    });
  }

  return [...found.values()].map(({file, node, label}) => {
    const own = files.get(file).scope.acquire(node), outside = new Set();
    for (const ref of own.through) if (ref.resolved?.defs.length) outside.add(ref.identifier.name);   // declared somewhere outside this function
    return {file, label, outside: [...outside]};
  });
}

const all = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? all(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
const sources = Object.fromEntries(all(EXTENSION).map(file => [file, fs.readFileSync(file, 'utf8')]));
const rel = file => path.relative(EXTENSION, file).split(path.sep).join('/');

test('every function the extension injects into a page uses nothing declared outside itself', () => {
  const found = injectedFunctions(sources);
  const broken = found.filter(item => item.outside.length).map(item => `${rel(item.file)}: ${item.label} uses ${item.outside.join(', ')}`);
  assert.deepEqual(broken, [], 'injected alone, these throw in the page: move what they use inside them');
});

test('the scan reaches the injected functions the extension is known to have (a scan that finds none would pass for nothing)', () => {
  const labels = injectedFunctions(sources).map(item => `${rel(item.file)}: ${item.label}`);
  for (const want of ['account-fill.js: pressRegister', 'account-fill.js: pressConsent', 'account-act.js: fillControl', 'visit-page.js: extractPage', 'sections.js: openClosedSections']) assert.ok(labels.includes(want), `${want} found among ${labels.length}`);
  assert.ok(labels.length >= 60, `${labels.length} injected functions`);
});

test('the scan names a planted outside helper, through a wrapper and through executeScript', () => {
  const file = path.join(EXTENSION, 'planted.js');
  const found = injectedFunctions({[file]: `
    const helper = () => 1;
    const run = (tab, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab}, func, args});
    export function press(name) { return helper() + name; }
    export const fine = name => name + 1;
    export const go = tab => run(tab, press, ['a']) && run(tab, fine, ['b']) && chrome.scripting.executeScript({target: {tabId: tab}, func: () => helper()});
  `});
  assert.deepEqual(found.map(item => [item.label.replace(/ \(line \d+\)/, ''), item.outside]).sort(), [['fine', []], ['inline', ['helper']], ['press', ['helper']]]);
});
