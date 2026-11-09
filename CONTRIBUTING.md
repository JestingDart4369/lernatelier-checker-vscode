# Working on Lernatelier Checker

## Setup

Node.js 22 or newer.

```sh
npm ci
npm run typecheck   # TypeScript, including the vendored library
npm test            # builds, then runs all tests
npm run package     # builds dist/extension.js and the .vsix
```

## Layout

- `src/core.ts`: everything that does not need VS Code (config, positions, report, command helpers). Unit-tested in `test/core.test.mjs`.
- `src/extension.ts`: the VS Code part (Problems panel, status bar, commands). Tested in `test/extension.test.mjs` against a stand-in for the VS Code API that loads the real `dist/extension.js`.
- `vendor/lernatelier-checker-js/`: the checking rules, an unmodified copy of the library (see `vendor/README.md`). Its own tests run from `test/upstream/`.
- `scripts/build.mjs`: bundles everything into `dist/extension.js` with esbuild and regenerates `THIRD-PARTY-NOTICES.md` from the packages that end up in the bundle.
- `test/fixtures/`: a complete Lernperiode, the empty template and a `lernperiode.json`.

## Branches and releases

- Work on `dev`. Every push runs the checks and replaces the **dev-build** pre-release on GitHub with a test `.vsix`.
- `main` is protected: changes only through a pull request from `dev`, and only when **build** passes.
- To release, raise `"version"` in `package.json`, add a section to `CHANGELOG.md`, and merge `dev` into `main`. The **Publish** workflow publishes to the Visual Studio Marketplace (Trusted Publishing), tags `v<version>` and creates a GitHub release.

## Commits

Author name `JestingDart4369`, email `JestingDart4369@users.noreply.github.com`.

## One-time setup

- Rulesets: Settings → Rules → Rulesets → Import, with `.github/rulesets/main.json` and `dev.json`.
- Trusted Publishing on the Marketplace publisher page: owner `JestingDart4369`, repository `lernatelier-checker-vscode`, workflow `publish.yml`, environment `marketplace`.
