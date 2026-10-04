// The one-glance caption beside "Current CV": ready, not read yet, or the read failed (then the error below says it, not a promise).
export function cvStateText(status, readFailed) {
  if (status.base) return `· ready · ${status.custom ? 'your design' : 'default design'}`;
  return readFailed ? '· not read' : '· not read yet: it happens on your first Tailor CV';
}
