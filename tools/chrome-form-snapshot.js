// JXA: osascript -l JavaScript tools/chrome-form-snapshot.js <job id> <snapshot script path>
// Runs tools/browser-form-snapshot.js in the Chrome tab showing this job's application form (not
// its confirmation page) and prints the JSON it returns; prints nothing when there is no such tab.
// Needs Chrome → View → Developer → Allow JavaScript from Apple Events; without it Chrome refuses
// and this exits non-zero, and the application record falls back to the kit's drafted answers.
ObjC.import('Foundation');

function run(argv) {
  const [id, scriptPath] = argv;
  const chrome = Application('Google Chrome');
  if (!chrome.running()) return '';
  const source = $.NSString.stringWithContentsOfFileEncodingError(scriptPath, $.NSUTF8StringEncoding, null).js;
  for (const window of chrome.windows()) {
    for (const tab of window.tabs()) {
      const url = tab.url() || '';
      if (url.includes(id) && !/\/(confirmation|thanks)\b/.test(url)) {
        return tab.execute({javascript: source}) || '';
      }
    }
  }
  return '';
}
