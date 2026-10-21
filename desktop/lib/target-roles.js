// Target roles in the app: the one list of job titles that is both matched against job titles and searched on job boards (twin of src/target_roles.py).
// search.target_roles = [{title, also: [fragments], fragment?}]; role_keywords and jobs_board_search_queries are derived from it. Guarded by
// desktop/test/target-roles.test.js, which runs the same cases as tests/test_target_roles.py (tests/fixtures/target_roles_cases.json).
export const SEARCHED = 5;   // titles typed into job boards (owner, 21 Oct 2026)
const META = /[\\^$.|?*+()[\]{}]/g;
const clean = text => String(text ?? '').split(/\s+/).filter(Boolean).join(' ');
export const titleFragment = title => clean(title).toLowerCase().replace(META, '\\$&');
const key = text => clean(text).toLowerCase();

// The fragment's plain words ("site reliability", "\\bsre\\b" -> "sre", "z[uü]rich" -> "zürich"), or null when it needs its regex (twin of target_roles.plain_term).
const ESCAPED = /^(?:[^\\^$.|?*+()[\]{}]|\\[\\^$.|?*+()[\]{}])+$/;
export function plainTerm(fragment) {
  const whole = /^\\b(.+)\\b$/.exec(fragment), inner = (whole ? whole[1] : fragment).replace(/\[(?:u(ü)|(ü)u|o(ö)|(ö)o|a(ä)|(ä)a)\]/g, (match, ...g) => g.slice(0, 6).find(Boolean));
  return ESCAPED.test(inner) ? inner.replace(/\\(.)/g, '$1') : null;
}

// The one list of a settings object: target_roles, or the two older lists read as one by exact text (searches first).
export function view(search = {}) {
  if (Array.isArray(search.target_roles)) return search.target_roles.map(role => (typeof role === 'string' ? {title: clean(role), also: []} : {...role, also: [...(role.also || [])]}));   // a draft from the AI lists plain titles
  const roles = [], covered = new Set();
  for (const query of search.jobs_board_search_queries || []) {
    if (!covered.has(key(query))) { covered.add(key(query)); roles.push({title: clean(query), also: []}); }
  }
  const own = new Set(roles.map(role => titleFragment(role.title)));
  for (const fragment of search.role_keywords || []) {
    if (own.has(fragment)) continue;
    const term = plainTerm(fragment);
    if (term !== null && titleFragment(term) === fragment) {
      if (!covered.has(key(term))) { covered.add(key(term)); roles.push({title: term, also: []}); }
    } else if (term !== null && !covered.has(key(term))) { covered.add(key(term)); roles.push({title: term, also: [], fragment}); }
    else roles.push({title: `/${fragment}/`, also: [], fragment});
  }
  return roles;
}

export function derive(roles, searched = SEARCHED) {
  const keywords = [];
  for (const role of roles) for (const fragment of [role.fragment || titleFragment(role.title), ...(role.also || [])]) if (!keywords.includes(fragment)) keywords.push(fragment);
  return {role_keywords: keywords, jobs_board_search_queries: roles.slice(0, searched).map(role => clean(role.title))};
}

// The settings with the one list and the two keys the engine reads written from it; settings with no roles at all stay as they are.
export function withDerived(search = {}) {
  const roles = view(search);
  if (!roles.length && !('target_roles' in search)) return search;
  return {...search, target_roles: roles, ...derive(roles)};
}

// A draft from the AI: plain titles, best first -> the stored list.
export const rolesOfTitles = titles => {
  const seen = new Set(), roles = [];
  for (const title of Array.isArray(titles) ? titles : []) {
    const text = clean(title);
    if (text.length >= 2 && text.length <= 60 && !seen.has(key(text))) { seen.add(key(text)); roles.push({title: text, also: []}); }
  }
  return roles;
};

export const titlesOf = search => view(search).map(role => role.title);
// Titles removed and added (a title already there, ignoring case, is kept with its variants); the keys follow.
export function editTitles(search, {add = [], remove = []} = {}) {
  const gone = new Set(remove.map(key)), roles = view(search).filter(role => !gone.has(key(role.title)));
  const have = new Set(roles.map(role => key(role.title)));
  for (const role of rolesOfTitles(add)) if (!have.has(key(role.title))) { have.add(key(role.title)); roles.push(role); }
  return withDerived({...search, target_roles: roles});
}
// A title moved to a place in the list: into the first SEARCHED it is also searched on job boards.
export function moveTitle(search, title, to) {
  const roles = view(search), from = roles.findIndex(role => key(role.title) === key(title));
  if (from < 0) return withDerived(search);
  const [role] = roles.splice(from, 1);
  roles.splice(Math.max(0, Math.min(to, roles.length)), 0, role);
  return withDerived({...search, target_roles: roles});
}
// A role word dropped by Tune (it names a fragment): a title with that fragment as its own goes; a variant is taken off its title.
export function dropFragment(search, fragment) {
  const same = other => String(other).toLowerCase() === String(fragment).toLowerCase();
  const roles = view(search).filter(role => !same(role.fragment || titleFragment(role.title))).map(role => ({...role, also: role.also.filter(item => !same(item))}));
  return withDerived({...search, target_roles: roles});
}
export const hasFragment = (search, fragment) => derive(view(search)).role_keywords.some(item => String(item).toLowerCase() === String(fragment).toLowerCase());
