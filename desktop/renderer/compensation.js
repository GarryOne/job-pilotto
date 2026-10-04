// The Profile's unanswered "Target: ❓" is a placeholder, not a value: with no real figure it reads as not set (UI loop #272).
export function compensationText(value) {
  const text = String(value || '').trim();
  return !text || (text.includes('❓') && !/\d/.test(text)) ? 'Not set in your Profile' : text;
}
