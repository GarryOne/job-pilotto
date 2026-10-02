// What a Jobs check told the person, read from the engine's log: the digest message ("<<<message … message>>>") lists the postings it kept, numbered, with their link.
// A suite that asks "did the check keep this posting?" reads it here: it exists without the AI (a job the AI could not score is in it, in Notion's scored list it is not)
// and it is after the person's own filters (a company to skip, a title to skip), which the stored jobs are not.
export function digestTitles(logText) {
  const titles = [];
  for (const [, message] of String(logText).matchAll(/<<<message\n([\s\S]*?)\nmessage>>>/g)) {
    for (const [, title] of message.matchAll(/^\d+\. (.+?) \(https?:\/\/[^)\s]+\)/gm)) titles.push(title.trim());
  }
  return titles;
}
