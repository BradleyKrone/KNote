---
name: release-check
description: Bump the version in package.json when the current one is already shipped, draft the matching resources/releaseNotes.md entry for the branch's changes, then run the exact CI gates from .github/workflows/pr-checks.yml (typecheck, lint, format:check, test, build, package) locally, auto-fixing formatting so a PR never fails CI on something this catches first.
---

Use this before pushing / opening a PR, or whenever the user asks to "update
release notes and check the build" or similar. Work the steps in order — the
version number is settled first, because the release-note entry has to be
written under the right heading. Goal: nothing that CI's
`Build & verify (Windows)` or `Release notes updated` jobs check should ever
surface for the first time in a failed GitHub Actions run — catch it here.

## 1. Version number — bump it if this branch's version is already shipped

Every release in this repo gets its **own** `##` section. Do not append to a
section that's already merged to `main` — `1.1.0`, `1.2.0` and `1.3.0` each
landed with their own feature merge, and adding to a shipped section makes the
notes lie about what a released version contained.

Decide with `package.json`, not by eyeballing the notes file:

```bash
git fetch origin main --quiet                       # refresh the ref first
git show origin/main:package.json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version'
node -p "require('./package.json').version"          # local
```

- **Local version > `origin/main`'s** — this branch already bumped. Add to the
  existing top section; change nothing else.
- **Local version == `origin/main`'s** — that version is shipped. Bump before
  writing any notes:
  1. Pick the level from what the branch actually contains — **minor** for a
     new feature or user-visible behavior change (the usual case here),
     **patch** for a fix-only or chore branch (see `1.0.1`).
  2. Edit `version` in `package.json`.
  3. Run `npm install --package-lock-only --ignore-scripts` so
     `package-lock.json` matches. It has drifted before (it sat at `1.2.0`
     through the `1.3.0` release); check `git diff --stat package-lock.json`
     shows only the two version lines and nothing else.
  4. Add a new `## <new version>` heading at the **top** of the version list in
     `resources/releaseNotes.md`, above the previous one.

If `origin/main` can't be resolved (no such ref, fetch fails offline), say so
rather than guessing — fall back to reading the top `##` heading against
`git log --oneline -- resources/releaseNotes.md` to judge whether it's already
merged, and ask the user if it's still ambiguous.

## 2. Release notes

Mirror the check in `.github/workflows/pr-checks.yml` (`release-notes` job):
it fails the PR unless `resources/releaseNotes.md` differs from `origin/main`
on this branch, unless the PR has a `skip-release-notes` label.

1. Run `git diff --name-only origin/main...HEAD` (fetch `origin/main` first if
   stale) and check whether `resources/releaseNotes.md` is in the list. If the
   branch has no commits yet, read the working tree (`git status --short`,
   `git diff`) instead — uncommitted work is still what the PR will carry.
2. If it's already updated, skip to step 3.
3. If not, look at what actually changed on this branch (`git diff
   origin/main...HEAD --stat` plus reading the diffs of touched
   `src/` files) and decide if it's user-facing:
   - **User-facing** (new feature, behavior change, bug fix a user would
     notice): add a bullet under the top `##` version heading — the one step 1
     just established. Match the file's existing terse style —
     bold lead phrase for features (e.g. `**Thing that changed**: ...`),
     plain sentence for fixes (e.g. `Fixed ... `). Look at the existing
     entries under that heading before writing to match tone and length —
     don't explain implementation, describe the user-visible effect.
   - **Not user-facing** (CI/build config, test-only changes, internal
     refactor, formatting fixes, chore): don't invent a bogus entry. Tell
     the user the change doesn't warrant a release note and that the PR
     should get the `skip-release-notes` label instead — offer to add it
     with `gh pr edit <number> --add-label skip-release-notes` if a PR
     already exists. Revert the step-1 version bump too: a branch with no
     release note doesn't earn a new version.
   - If genuinely unsure which bucket it's in, ask rather than guessing at
     user-facing copy.

## 3. Build gates, in CI order

Run these in exactly this order — the same order and commands as the
`build` job in `.github/workflows/pr-checks.yml` — and stop at the first
failure to fix it before moving on, since a later step can mask an earlier
one:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run format:check`
4. `npm test`
5. `npm run build`
6. `npm run package`

### Handling failures

- **`format:check` fails** (this is what broke PR #19 — Prettier flagged
  `src/core/indexer/vaultIndex.ts`): run `npm run format` (Prettier
  `--write`) to auto-fix, then re-run `npm run format:check` to confirm it's
  clean. Show the user which files changed (`git diff --stat`) before
  moving on — don't just silently reformat and continue.
- **`lint` fails**: read the errors first. Only reach for `npx eslint --fix`
  when the failures are clearly mechanical (unused import, sort order,
  etc.); anything that needs a real code change, fix by hand and explain
  what and why.
- **`typecheck` / `test` / `build` / `package` fail**: these indicate a real
  bug, not a style nit — investigate and fix the root cause, then re-run
  from step 1 (a fix can reintroduce a formatting or lint issue).

## 4. Report

State the version this branch will ship as, and whether you bumped it or it
was already bumped. Summarize what changed in `resources/releaseNotes.md` (or
why it was skipped) and give a pass/fail line for each of the six build gates.
If everything passes, this branch is in the same state CI will see — safe to
commit/push.

Run the gates **after** the version bump, not before: `npm run package` builds
the `.vsix` from `package.json`, so bumping afterwards invalidates the run.
Delete any stale `knote-<old version>.vsix` the run leaves in the repo root
(they're gitignored, but they pile up).
