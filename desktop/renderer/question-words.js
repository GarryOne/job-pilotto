// The words of a "Which job is this email about?" question, shared by the Gmail card (pages/activity.js) and its popup (pages/reassign.js).

// An invitation (a calendar email) or any other email.
export const emailNoun = email => (/invit|calendar|meeting/i.test(`${email?.subject || ''} ${email?.sender || ''}`) ? 'invitation' : 'email');

// Why it is asked: what the email names, and what it lacks.
export const questionWhy = (noun = 'email', company = '') => (company ? `The ${noun} names ${company} but doesn't specify the role.`
  : "The check couldn't tell which job this is about, so it moved nothing.");

// The popup's three answers: the line under them and the button, per answer.
export const CHOICES = {
  tracked: {note: 'This email will be linked to the job you pick.', save: 'Link email'},
  new: {note: 'This email will be linked to the new job.', save: 'Create job & link email'},
  none: {note: 'This email stays out of your applications.', save: 'Save'},
};
