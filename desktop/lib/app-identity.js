// The app is called Jobadabra, but its data folder and the Keychain item that seals its tokens were made under "Job Pilotto": both follow app.name, so keep them on the old name.
// Guarded by test/app-identity.test.js; the data folder and Keychain move to the new name later, as a migration of their own.
import path from 'node:path';

export const LEGACY_NAME = 'Job Pilotto';

// Call before anything reads userData (a later app.setPath, for tests and demos, still wins). Electron fixes the Keychain item's name
// ("<app name> Safe Storage") the first time safeStorage seals something, so seal once under the old name, then take the new one (menus, About).
export function keepLegacyIdentity({app, safeStorage, displayName = 'Jobadabra'}) {
  app.setName(LEGACY_NAME);
  app.setPath('userData', path.join(app.getPath('appData'), LEGACY_NAME));
  app.whenReady().then(() => {
    try { if (safeStorage.isEncryptionAvailable()) safeStorage.encryptString('keychain-name'); } catch { /* no keychain here (CI): nothing to keep */ }
    app.setName(displayName);
  });
}
