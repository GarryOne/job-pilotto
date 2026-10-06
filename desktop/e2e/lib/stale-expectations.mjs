// An e2e step that still asserts words the window no longer shows is a false positive waiting for the next gate (5 Oct 2026: the calendar redesign changed "Nothing scheduled" to "No upcoming
// interviews", and #299 was the suite reporting the old words as a bug; #300 was the same for a Focus step). Found when the words are removed, not when the gate fails hours later: the
// pre-push hook (tools/stale-expectations.mjs) lists the quoted words a push removes from the window's code that an end-to-end suite still expects. Pure.
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\\n]){10,140})\1/g;
const TAGGED = />([^<>{}]{10,140})</g;

// Words that read as something a person sees: two or more words, no code in them.
const looksLikeWords = text => /[A-Za-z]{3}[^A-Za-z]+[A-Za-z]{2}/.test(text) && !/[${}=;()[\]\\]|=>|^\s*(?:https?:|\.|#|\/)/.test(text);

// The unified diff of the window's code -> the words its removed lines held.
export function removedWords(diff) {
  const out = new Set();
  for (const line of String(diff || '').split('\n')) {
    if (!line.startsWith('-') || line.startsWith('---')) continue;
    const body = line.slice(1);
    for (const hit of body.matchAll(QUOTED)) if (looksLikeWords(hit[2])) out.add(hit[2].trim());
    for (const hit of body.matchAll(TAGGED)) if (looksLikeWords(hit[1])) out.add(hit[1].trim());
  }
  return [...out];
}

// removed: the words; present: all the text still in the product (window, app logic, engine); suites: [{file, text}] -> [{word, file, line}]: a suite line that still expects a removed word.
export function staleExpectations({removed = [], present = '', suites = []}) {
  const gone = removed.filter(word => !present.includes(word));
  const found = [];
  for (const {file, text} of suites) {
    String(text).split('\n').forEach((line, index) => { for (const word of gone) if (line.includes(word)) found.push({word, file, line: index + 1}); });
  }
  return found;
}

export const staleMessage = found => ['An end-to-end step still expects words or selectors the window no longer has (it would fail the next gate as a "bug"):',
  ...found.slice(0, 8).map(item => `  ${item.file}:${item.line}  "${item.word}"`),
  'Update the step to the new words in the same change (or say so with STALE_EXPECT_OK=1 git push ...).'].join('\n');

// The same for selectors (6 Oct 2026, instead of rewriting every suite onto test ids): an id, class or data- attribute a push removes from the window that a
// suite still selects on. Names a suite uses: `#id`, `.class` and `[data-x]` inside the strings it passes to the page.
const SELECTOR_CALL = /(?:click|locator|waitForSelector|querySelector(?:All)?|getElementById|\$\$?|closest|matches|has)\(\s*(['"`])((?:(?!\1).)*)\1/g;
export function selectorNames(text) {
  const names = new Set();
  for (const [, , css] of String(text).matchAll(SELECTOR_CALL)) {
    for (const [, name] of css.matchAll(/(?:^|[\s>+~,(:])?[#.]([a-zA-Z][\w-]{2,})/g)) names.add(name);
    for (const [, name] of css.matchAll(/\[(data-[\w-]+)/g)) names.add(name);
  }
  for (const [, id] of String(text).matchAll(/getElementById\(\s*['"`]([\w-]{3,})/g)) names.add(id);
  return names;
}
// diff: the window's unified diff; present: the window's code now; suites: [{file, text}] -> [{word, file, line}] for a selector name the push removed and nothing has any more.
export function staleSelectors({diff = '', present = '', suites = []}) {
  const removedText = diff.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).join('\n');
  const has = (text, name) => new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(text);
  const found = [];
  for (const {file, text} of suites) {
    const lines = String(text).split('\n');
    lines.forEach((line, index) => {
      for (const name of selectorNames(line)) if (has(removedText, name) && !has(present, name)) found.push({word: name, file, line: index + 1});
    });
  }
  return found;
}
