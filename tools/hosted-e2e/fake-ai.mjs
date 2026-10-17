// A stand-in for Workers AI (env.AI) in the hosted e2e: no model, no cost. A structured ask (response_format json_schema) is answered with a value that fits the schema
// (numbers high, text "ok", lists empty), so every AI step the engine takes in a scheduled search gets a valid answer; the calls are counted for the debit check.
export function fromSchema(schema) {
  if (!schema || typeof schema !== 'object') return null;
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  const pick = schema.anyOf || schema.oneOf;
  if (pick) return fromSchema(pick.find(part => part.type !== 'null') || pick[0]);
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, part]) => [key, fromSchema(part)]));
  if (type === 'array') return [];
  if (type === 'integer' || type === 'number') return Math.min(schema.maximum ?? 85, Math.max(schema.minimum ?? 0, 85));
  if (type === 'boolean') return true;
  return 'ok';
}

export function fakeAi() {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      const schema = input.response_format?.json_schema?.schema;
      calls.push({model, structured: !!schema});
      return {response: JSON.stringify(schema ? fromSchema(schema) : {ok: true}), usage: {prompt_tokens: 1200, completion_tokens: 80}};
    },
    async toMarkdown() { return [{data: ''}]; },
  };
}
