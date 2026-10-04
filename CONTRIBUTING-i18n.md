# Translating Timelines

Thanks for helping translate Timelines. This guide covers adding a new language and
the conventions the codebase follows.

## Adding a language

1. Create a folder named after the locale code under `src/locales/`. Use the plain
   language code (`de`, `fr`, `ja`) unless the translation is region specific, in
   which case use the full tag (`pt-BR`, `zh-Hans`).
2. Run `npm run i18n:extract`. This fills the new folder with one JSON file per
   namespace, every key present and every value an empty string.
3. Add the locale to `SUPPORTED_LOCALES` in [`src/i18n/config.js`](src/i18n/config.js).
   `nativeName` is what the language picker shows, so write it in the language itself
   ("Português (Brasil)", not "Brazilian Portuguese").
4. Translate the values. Leave anything you have not translated as an empty string.
5. To see your work, run `npm install` once, then `npm run electron:dev`, and pick your
   language in App Settings > General > Language. The picker only appears once a second
   language is listed in `SUPPORTED_LOCALES`, so step 3 is what makes it show up.
6. Run `npm run i18n:check` before opening a pull request.

**You can translate incrementally.** An empty string falls back to English for that
one key, so a half-finished translation is safe to ship. There is no need to complete
a namespace before opening a pull request.

## The namespaces

| File | Contents |
|---|---|
| `common.json` | Shared buttons, panel names, validation messages |
| `app.json` | Home screen, modals, export dialogs, marketplace (desktop app only) |
| `settings.json` | App settings and timeline settings (desktop app only) |
| `timeline.json` | Timeline canvas, sidebar, right panel, spreadsheet |
| `viewer.json` | Web viewer landing page |

`common.json`, `timeline.json` and `viewer.json` also ship in the web viewer, so keep
them free of desktop-only wording. The viewer has no language picker. It follows the
browser's language.

## Placeholders and plurals

**Placeholders** look like `{{name}}` and are substituted at runtime. Keep them exactly
as written, but move them wherever the sentence needs them:

```json
"confirmSingular": "Are you sure you want to delete \"{{title}}\"? This cannot be undone."
```

**Numbered tags** like `<1>` wrap part of a sentence in a link or bold text. Keep the
pair intact and move it as a unit:

```json
"whatsNew": "See what's new in <1>v{{version}}</1>."
```

**Plurals** appear as several keys sharing a prefix. English has two forms, Portuguese
has three, Polish has four. `npm run i18n:extract` generates the correct set for your
locale from CLDR rules, so translate whichever keys it creates and do not add or remove
forms by hand:

```json
"events_one": "{{count}} evento",
"events_many": "{{count}} de eventos",
"events_other": "{{count}} eventos"
```

## What is deliberately not translated

Some English-looking strings are data or identifiers, not interface text. They are not
in the catalogs, and they should stay that way:

- **Era markers** (`negID`, `posID`, `approxID`, for example "BCE", "CE", "c.") are set
  per timeline by the person using the app. Translating them would rewrite their files.
- **Element titles, tags, group names and note contents** belong to the user.
- **`untitled`** in filename previews mirrors a real filename on disk.
- **Date format patterns** (`MM/DD/YYYY`, `YYYY-MM-DD`) describe literal formats.
- **Example URLs** in input placeholders.
- **Lucide icon names** in the icon picker, which are search keys.

## Dates and times

Date format (MDY, DMY, ISO) and time format (12 or 24 hour) are **per-timeline settings,
not language settings**. Someone writing in Portuguese may still deliberately want ISO
dates, so changing the interface language never changes them.

Month abbreviations on the timeline axis are the exception. They follow the interface
language automatically through `Intl.DateTimeFormat`, so no translator has to list them.

## Conventions for code contributors

Every user-facing string goes through `t()` with a semantic key and the English text as
the default value:

```jsx
const { t } = useTranslation("timeline");
<label>{t("fields.name", "Name")}</label>
```

The English default is what `npm run i18n:extract` writes into `src/locales/en/`, so
English catalogs are generated, never edited by hand. CI runs `npm run i18n:check` and
fails when a string is added without regenerating the catalogs. Fix it by running
`npm run i18n:extract` and committing the result.

Three rules worth knowing:

- **Keys must be static.** `t("iconCategories." + cat.id)` cannot be extracted. Where a
  key is chosen at runtime, spell out every possibility in a lookup map so the parser
  can see them all. `IconPicker` and `ExportPngModal` show the pattern.
- **Keep `t` out of hook dependencies that cause writes.** `t` changes identity when the
  language changes. In a debounced save effect that would trigger a spurious save, so
  store a stable error code in state and translate at render instead. `SettingsModal`
  and `src/i18n/validationMessages.js` show the pattern.
- **Use `<Trans>` for sentences containing markup**, not string concatenation, so the
  translator controls word order around the embedded element.
