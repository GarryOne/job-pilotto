// Logged activity: the green box that links to the job a run created or updated ("Job created — <title>", Open job
// in Notion, Show in Jobs), in Recent activity's run detail and the Log box's result. No imports, so it's tested
// without a window (test/job-link.test.js); jobActions builds its buttons only when called.
export const jobHeadline = job => `${job?.created ? 'Job created' : 'Job updated'}${job?.title ? ` — ${job.title}` : ''}`;

const bare = id => String(id || '').replace(/-/g, '');
// A run read from Notion knows only the job's page (its Application relation) until its log is read: its title and
// its key in the Jobs list (Job URL) then come from the list, by page id.
export function withListJob(job, jobs = []) {
  if (!job) return null;
  const listed = job.pageId ? jobs.find(entry => entry.page_id && bare(entry.page_id) === bare(job.pageId)) : null;
  return {...job, title: job.title || listed?.title || '', jobUrl: job.jobUrl || listed?.url || ''};
}

// The two links: Open job in Notion (⌘-click: in a Job Pilotto window, like everywhere else) and Show in Jobs
// (the Jobs list filtered to it), the second only when the job's key is known.
export function jobLinkActions(job, {openNotion, show}) {
  return [
    {id: 'notion', label: 'Open job in Notion ↗', run: event => openNotion(job.url, !!(event?.metaKey || event?.ctrlKey))},
    ...(job.jobUrl ? [{id: 'jobs', label: 'Show in Jobs', run: () => show(job)}] : []),
  ];
}

export function jobActions(job, handlers) {
  const box = document.createElement('div');
  box.className = 'alert-actions';
  for (const action of jobLinkActions(job, handlers)) {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'link', textContent: action.label});
    button.dataset.jobLink = action.id;
    button.addEventListener('click', event => { event.preventDefault(); action.run(event); });
    box.append(button);
  }
  return box;
}
