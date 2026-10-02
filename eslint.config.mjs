// Catch undeclared names and flag unused code across the desktop app and Chrome extension.
import {createRequire} from 'node:module';
const globals = createRequire(new URL('./desktop/package.json', import.meta.url))('globals');

export default [
  {ignores: ['**/node_modules/**', 'desktop/dist/**', 'desktop/build/**', 'desktop/shared/**', 'desktop/renderer/vendor/**']},
  {
    files: ['desktop/**/*.js', 'desktop/**/*.mjs', 'desktop/**/*.cjs', 'extension/**/*.js'],
    languageOptions: {globals: globals.node},
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', {args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_'}],
    },
  },
  {files: ['desktop/renderer/**/*.js', 'desktop/demo/**/*.js', 'desktop/preload.cjs'], languageOptions: {globals: globals.browser}},
  {files: ['extension/**/*.js'], languageOptions: {globals: {...globals.browser, chrome: 'readonly'}}},
];
