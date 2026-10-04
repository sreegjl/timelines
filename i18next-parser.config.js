import fs from 'node:fs';

// Locale folders are the source of truth, so adding src/locales/<code>/ is all a translator needs.
const locales = fs
  .readdirSync('src/locales', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

export default {
  locales,
  input: ['src/**/*.{js,jsx}'],
  lexers: { js: ['JavascriptLexer'], jsx: ['JsxLexer'] },
  output: 'src/locales/$LOCALE/$NAMESPACE.json',
  defaultNamespace: 'common',
  keySeparator: '.',
  namespaceSeparator: ':',
  // English is generated from the defaultValue in each t() call; other locales start empty and fall back.
  defaultValue: (locale, namespace, key, value) => (locale === 'en' ? value || '' : ''),
  // Keeps English in sync when a default changes in code; other locales keep their translations.
  resetDefaultValueLocale: 'en',
  createOldCatalogs: false,
  keepRemoved: false,
  sort: true,
  indentation: 2,
  lineEnding: 'lf',
  verbose: false,
};
