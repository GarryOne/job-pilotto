// The store on this Mac, desktop side: the user's texts are Markdown files in the app's folder (profile.md, answers.md, knowledge.md),
// the same files the engine's sqlite adapter reads (lib/pipeline-env.js passes their paths). Tracked records (applications, runs…) live
// in the engine's data/tracker.sqlite and are reached through engine commands, never opened here. Spec:
// docs/superpowers/specs/2026-10-09-store-adapters.md. Guarded by desktop/test/store-contract.test.js.
import * as md from './markdown-page.js';

export const NAME = 'sqlite';
export const CAPS = new Set();
export const FILES = {profile: 'profile.md', answers: 'answers.md', knowledge: 'knowledge.md'};

export function open(storage) {
  const page = name => {
    const file = FILES[name];
    if (!file) throw new Error(`No text called ${name}`);
    const read = () => storage.readText(file);
    const edit = change => storage.writeText(file, change(read()));
    return {
      blocks: async () => md.blocks(read()),
      outline: async () => md.outline(read()),
      text: async () => md.readable(read()),
      write: async markdown => storage.writeText(file, String(markdown).replace(/\s*$/, '\n')),
      setText: async (block, value) => edit(text => md.setText(text, block, value)),
      remove: async block => edit(text => md.remove(text, block)),
      append: async values => { if (values.length) edit(text => md.append(text, values)); },
      insertAfter: async (blockId, values) => edit(text => md.insertAfter(text, blockId, values)),
      async appendHeading(value) {
        const [text, id] = md.appendHeading(read(), value);
        storage.writeText(file, text);
        return id;
      },
      setCell: async (row, index, value) => edit(text => md.setCell(text, row, index, value)),
    };
  };
  return {name: NAME, caps: CAPS, page, link: () => null, textLink: () => null};
}
