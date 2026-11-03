---
name: release
description: Cut a JSR release - bump the version, verify, commit and tag, then push only after the user confirms.
argument-hint: "patch | minor | major"
disable-model-invocation: true
---

Cut a release. Increment: $ARGUMENTS (use `patch` if empty).

1. Preconditions: the branch is `main`, `git status --porcelain` is empty, and after `git fetch` the branch is level with `origin/main`. If any fails, stop and say which.
2. Run `deno task ci` and `deno publish --dry-run`. Stop on any failure and show it.
3. Run `deno bump-version <increment>`, then read the new `version` from `deno.json`.
4. Commit `deno.json` with the message `vX.Y.Z` and create the tag with `git tag -a vX.Y.Z -m vX.Y.Z`.
5. Ask the user before running `git push origin main vX.Y.Z`. Pushing the tag starts `.github/workflows/publish.yml`, which publishes to JSR and creates the GitHub release with generated notes, and a published JSR version cannot be replaced. If they decline, leave the commit and tag local and say how to undo them (`git tag -d vX.Y.Z` and `git reset --hard HEAD~1`).
