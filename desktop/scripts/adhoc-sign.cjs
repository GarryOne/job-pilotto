// electron-builder afterPack hook: ad-hoc sign the whole app bundle.
// With signing off ("identity": null) only Electron's main binary keeps its linker signature, with no
// seal over the bundle's resources, and macOS reports the downloaded app as "damaged". A complete
// ad-hoc signature turns that into the usual "unverified developer" prompt (Privacy & Security →
// Open Anyway) until the app is signed with a Developer ID and notarised.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
