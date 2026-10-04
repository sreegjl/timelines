# Contributing to Timelines

Thanks for your interest in Timelines! Bug reports, ideas, themes, translations and code
are all welcome.

## Ways to contribute

- **Bugs:** open an [issue](https://github.com/sreegjl/timelines/issues) with steps to
  reproduce, your OS and app version, and a screenshot or small `.timeline` file if it
  helps.
- **Feature ideas:** add them to the
  [Feature Suggestions & Roadmap](https://github.com/sreegjl/timelines/issues/8) issue.
- **Themes:** these live in the
  [timelines-marketplace](https://github.com/sreegjl/timelines-marketplace) repo.
- **Translations:** see [CONTRIBUTING-i18n.md](CONTRIBUTING-i18n.md).

## Setup

You'll need [Node.js LTS](https://nodejs.org/).

```bash
git clone https://github.com/sreegjl/timelines.git
cd timelines
npm install
npm run electron:dev
```

Use `npm run dev:viewer` to work on the web viewer instead. Dev mode runs slower than a
packaged build (`npm run electron:build`).

Before opening a pull request, run:

```bash
npm run lint
npm test
npm run i18n:check
```

## Code conventions

- Match the style of the file you're editing, and keep comments to one short line.
- Put new buttons and controls in an existing toolbar, panel or menu rather than adding
  a new bar or floating container for them.
- Send every user-facing string through `t()` with the English text as the default,
  then run `npm run i18n:extract`. See the code section of
  [CONTRIBUTING-i18n.md](CONTRIBUTING-i18n.md).
- New versions must still open older `.timeline` files, so give new fields a default
  when they're missing.
- New timeline settings need handling in `handleUpdateTimeline` in `src/App.jsx`.
- Note and asset folders are keyed by `file.uid`, not `file.id`. Use `getStorageId()`
  from `src/utils/idUtils.js`.
- `electron/timelinePackage.cjs` and `src/utils/packageReader.js` both read packaged
  `.timeline` files, so keep them in sync.
- Use `--link-color` for accent colors, not the legacy `--accent-color`.

## Pull requests

- Smaller PRs that each cover one feature or fix are much easier to review and merge, so
  please split up larger work where you can.
- Explain what changed and why, link any related issue, and add a screenshot for visible
  changes.

## License

Timelines is licensed under [GPL-3.0](LICENSE). By contributing, you agree your
contributions are released under the same license.
