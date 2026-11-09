# Vendored: lernatelier-checker-js

`vendor/lernatelier-checker-js` is an unmodified copy of
[djlauk/lernatelier-checker-js](https://github.com/djlauk/lernatelier-checker-js) by Daniel J. Lauk,
licensed under MIT (see `vendor/lernatelier-checker-js/LICENSE`).

- Commit: `b5699025d2e673e65a6296b1b081f1523946aa1f`
- Copied: `src/*.ts`, `templates/Lernperiode-NR.md`, `LICENSE`
- The upstream tests are in `test/upstream/`, with only the import paths changed.

The library has no npm release yet, so it is copied here and bundled by `scripts/build.mjs`.
Its runtime dependencies (`unified`, `remark-parse`, `remark-gfm`) are in `devDependencies`
because they are bundled into `dist/extension.js`.

## Updating

1. Copy `src/*.ts`, `templates/Lernperiode-NR.md` and `LICENSE` from the new upstream commit.
2. Copy `test/checker.test.mjs` to `test/upstream/checker.test.mjs` and change its imports to
   `../../out/upstream/index.js` and the template path to
   `../../vendor/lernatelier-checker-js/templates/Lernperiode-NR.md`.
3. Update the commit above and the CHANGELOG, then run `npm test`.
