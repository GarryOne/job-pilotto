// The Jobs filter box: words match title, company and place; a pasted link matches the job's own link,
// with or without https://, www., a trailing slash, tracking parameters or #anchor.
export const linkKey = url => String(url || '').trim().toLowerCase()
  .replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

// A link, not words: has a dot before a slash and no spaces ("jobs.ch/en/vacancies/detail/…").
export const looksLikeLink = text => /^\S*\.[a-z]{2,}\/\S*$/i.test(String(text || '').trim()) || /^https?:\/\//i.test(String(text || '').trim());

export function matches(job, text) {
  text = String(text || '').trim();
  if (!text) return true;
  if (looksLikeLink(text)) return linkKey(job.url) === linkKey(text) || linkKey(job.url).startsWith(`${linkKey(text)}/`);
  const words = text.toLowerCase();
  return `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(words) || String(job.url || '').toLowerCase().includes(words);
}
