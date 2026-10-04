// What the "Answer once" card says when its questions couldn't be read: nothing while Notion isn't connected, else one plain line.
export function questionsProblem(error) {
  if (/Connect Notion first/i.test(error || '')) return {hide: true, text: ''};
  return {hide: false, text: "Couldn't read your questions from Notion just now. Try again in a moment."};
}
