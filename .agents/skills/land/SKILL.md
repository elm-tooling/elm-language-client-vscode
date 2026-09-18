---
name: land
description: >-
  Land changes for elm-tooling/elm-language-client-vscode only when the user has
  explicitly requested landing (for example via Land Changes or /land). Do not
  invoke for review, preparation, or verification-only requests.
metadata:
  delta-action: land
---

# Land changes for elm-language-client-vscode

This skill executes an explicit landing request end-to-end. If invoked by Land Changes or `/land`, that is already merge intent: do not ask again whether to merge.

## Repository scope

- Repository: `elm-tooling/elm-language-client-vscode`
- Destination remote/branch: `origin/main`
- Merge style: merge commit (matches current history)

## Sources of truth for commands used here

- Root verify command: `npm run verify` (`package.json` scripts.verify)
- Packaging + E2E coverage in CI matrix: `.github/workflows/compile.yaml`
  - `npm ci`, `npm run compile`, `npm run smoke`, `npm --prefix client run lint`, `npm --prefix client test`
  - `npm run package`, `npm run test:e2e`, `npm run test:e2e-web`
- CI submodule behavior: `git submodule update --init --depth=1 -- server` (`.github/workflows/compile.yaml`)
- Release/publish is tag/release-driven (not part of normal landing): `HOW_TO_RELEASE.md`, `.github/workflows/deploy_extension*.yaml`

## Conflict policy

User preference: **auto-resolve clear conflicts and continue**.

- Attempt automatic conflict resolution only when the intended result is unambiguous and does not drop unrelated user changes.
- If conflict resolution is ambiguous or unsafe, stop and report failure with what needs human input.

## Workflow

1. **Preflight and scope safety**
   - Confirm current repo is `elm-language-client-vscode` and `origin` exists.
   - Record current branch and `git status --short`.
   - If there are unstaged/untracked changes that are clearly unrelated to the requested landing scope, stop and ask which paths to include. Do not discard or overwrite unrelated work.

2. **Prepare branch from current work state**
   - If on `main`, create a topic branch (for example `land/<yyyy-mm-dd>-<topic>`).
   - Stage only approved files and create a commit if needed.
   - Never open an interactive editor; use non-interactive commit flags/messages.

3. **Sync with latest destination and resolve conflicts**
   - Fetch `origin/main`.
   - Rebase topic branch onto `origin/main` (or merge `origin/main` into topic branch if rebase is unsafe in this context).
   - If conflicts occur, auto-resolve only clear cases, then continue and re-run verification. If not clear/safe, stop and report failure.

4. **Run required local verification**
   - Ensure submodule exists as CI expects:
     - `git submodule update --init --depth=1 -- server` (source: `.github/workflows/compile.yaml`)
   - Run:
     - `npm run verify` (source: `package.json` scripts.verify)
   - If verification fails, do not land.

5. **Publish branch and open/update PR**
   - Push topic branch to `origin`.
   - Open a PR to `main` if one does not exist; otherwise update existing PR.
   - Use explicit non-interactive metadata (`--title`, `--body`, `--base main`, `--head <branch>`).

6. **Verify required remote checks before merge**
   - Wait for PR checks to complete (`gh pr checks --watch`).
   - Require a successful result for the PR HEAD commit; pending/failing/missing/unverifiable checks block landing.

7. **Land the PR**
   - Merge with merge-commit strategy (`gh pr merge --merge --delete-branch=false`), matching repository history.
   - If merge is blocked by new conflicts or failed checks, stop and report failure.

8. **Post-merge verification**
   - Verify PR state is merged.
   - Verify merge commit is reachable from `origin/main` after fetch.
   - Capture:
     - merged commit short SHA and URL
     - a successful CI/check URL tied to the landed PR commit

9. **Outcome reporting**
   - In subthreads where `report_subthread_status` is available, send exactly one final status event:
     - success example: `status: success`, `title: Landed on main`, `description: [abc1234](<commit-url>) · [CI passed](<check-url>).`
     - failure example: `status: failure`, `title: Blocked by CI`, `description: [Tests failed](<check-url>) for [abc1234](<commit-url>). Not landed.`
   - If not in a subthread, report the same outcome directly in chat.
   - Never report success before verifying the change reached `origin/main`.

## Hard stops

- Required checks not green for PR HEAD.
- Ambiguous/unsafe merge conflict.
- Missing push/merge permissions.
- Unclear file scope that risks landing unrelated changes.

On hard stop, do not claim landing completed. Report exactly what is blocking and what human decision/action is required.
