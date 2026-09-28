// A tiny in-memory Notion page for tests: its blocks (bullets and headings) and a fetcher for notion.js calls
// (list children, append — optionally after a block —, update a block's text, delete a block).
export function fakeNotion(lines = []) {
  let next = 1;
  const make = (type, text) => ({id: `b${next++}`, type, text});
  const blocks = lines.map(line => (line.startsWith('## ') ? make('heading_2', line.slice(3)) : make('bulleted_list_item', line)));
  const rich = text => ({rich_text: [{plain_text: text, text: {content: text}}]});
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    let data = {};
    if (init.method === 'GET' && route.endsWith('/children')) {
      data = {results: blocks.map(b => ({id: b.id, type: b.type, [b.type]: rich(b.text), has_children: false})), has_more: false};
    } else if (init.method === 'PATCH' && route.endsWith('/children')) {
      const added = body.children.map(child => make(child.type, child[child.type].rich_text[0].text.content));
      const at = body.after ? blocks.findIndex(b => b.id === body.after) + 1 : blocks.length;
      blocks.splice(at, 0, ...added);
      data = {results: added.map(b => ({id: b.id}))};
    } else if (init.method === 'PATCH') {
      const block = blocks.find(b => `blocks/${b.id}` === route);
      block.text = body[block.type].rich_text[0].text.content;
    } else if (init.method === 'DELETE') {
      blocks.splice(blocks.findIndex(b => `blocks/${b.id}` === route), 1);
    } else if (init.method === 'GET' && route.startsWith('pages/')) {
      data = {parent: {page_id: 'parent'}};
    } else if (init.method === 'POST' && route === 'pages') {
      data = {id: 'knowledge-page'};
    }
    return {ok: true, json: async () => data};
  };
  return {blocks, fetcher, texts: () => blocks.map(b => (b.type === 'heading_2' ? `## ${b.text}` : b.text))};
}
