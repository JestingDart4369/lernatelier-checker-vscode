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

## Working together

1. Get the newest `dev`: `git switch dev && git pull`.
2. Make a branch for one change: `git switch -c feature/kurzer-name` (or `fix/…`).
3. Commit in small steps, run `npm run typecheck` and `npm test`, push the branch.
4. Open a pull request **into `dev`** and fill in the template. CI runs; the other person reviews.
5. Merge with **Squash and merge** when it is approved and green, then delete the branch.

Try your change in VS Code with **Run → Start Debugging** (F5): it builds and opens a second VS Code window with the extension and the test fixtures. Every push to `dev` also replaces the **dev-build** pre-release on GitHub with a test `.vsix`.

Rules (see `.github/rulesets/`):

- `dev` and `main` only change through pull requests with one approval and a green **build** check. The owner can bypass in an emergency.
- Paths in `.github/CODEOWNERS` (workflows, `package.json`, licence, privacy text, vendored rules, build script) always need the owner's review.
- Releases are the owner's: raise `"version"` in `package.json`, rename the `## Unreleased` section in `CHANGELOG.md` to that version, open a pull request from `dev` to `main`. Merging runs **Publish** (Marketplace via Trusted Publishing, tag `v<version>`, GitHub release). Collaborators never need Marketplace access or tokens.
- The **Upstream watch** workflow runs every Monday: when djlauk/lernatelier-checker-js has a new commit, it tries the update in the runner (see `vendor/README.md`) and opens an issue saying whether type check and tests still pass. It needs Issues enabled in the repository settings.

## Commits

- Use your GitHub username and your GitHub noreply address, so no private e-mail ends up in the history:
  `git config user.name "<username>"` and `git config user.email "<id>+<username>@users.noreply.github.com"` (shown under GitHub → Settings → Emails).
- No real names, e-mail addresses, school data or tokens in code, tests, fixtures or commit messages.
- Write commit messages as one short line saying what changes ("Sidebar: show next school day").

## One-time setup

- Rulesets: Settings → Rules → Rulesets → Import, with `.github/rulesets/main.json` and `dev.json` (replace the old ones).
- Collaborator: Settings → Collaborators → Add people, role **Write**.
- Environment `marketplace`: Settings → Environments → marketplace → Required reviewers: the owner, and Deployment branches: `main` only. Then nothing can be published without the owner's click.
- Trusted Publishing on the Marketplace publisher page: owner `JestingDart4369`, repository `lernatelier-checker-vscode`, workflow `publish.yml`, environment `marketplace`.
