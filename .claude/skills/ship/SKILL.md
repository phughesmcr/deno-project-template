---
name: ship
description: Ship the current change through a pull request - branch, commit, push, wait for CI, squash-merge, and return to an updated main.
argument-hint: [#issue] [commit message]
disable-model-invocation: true
allowed-tools: Bash(git push *) Bash(gh pr create *) Bash(gh pr merge *)
---

Ship the current change. Running this skill is the go-ahead to push, open a pull request and merge it. Arguments, if any: $ARGUMENTS

1. Run `git fetch`, then read `git status --short` and `git diff HEAD --stat`. If nothing changed and the branch has no commits ahead of `origin/main`, say so and stop.
2. Run `deno task ci`. Stop on failure and show it.
3. If on `main`, create a branch named for the change (`git switch -c <kebab-case-summary>`). If `main` had commits ahead of `origin/main`, they are on the new branch now, so run `git branch -f main origin/main` to keep the later pull a fast-forward. Commit the changes with a message in the imperative mood: the one given, or one you write from the diff.
4. `git push -u origin HEAD`, then `gh pr create --fill`. If the work came from an issue (an `#N` argument, or a `/slice #N` earlier in this session), pass `--body` instead with a one-paragraph summary that ends `Fixes #N`.
5. `gh pr checks --watch --fail-fast` (if it reports no checks yet, run it again). If a check fails, read `gh run view <run-id> --log-failed`, fix the cause, run `deno task ci`, commit and push, then watch again. After two failed fixes, stop and report what is failing.
6. `gh pr merge --squash --delete-branch`, then `git switch main && git pull --ff-only`. If the merge is blocked for any reason other than pending checks, stop and say why; never pass `--admin`.
7. Finish with the PR URL and the merged commit.
