# deno-project-template

Deno 2.9 library. Source lives in `src/`, tests in `tests/`. To start a project from it, clone it and run `/new-project` in Claude Code. The toolchain is pinned to Deno 2.9.8 in [`.tool-versions`](./.tool-versions).

```sh
deno task dev    # tests, rerun on save
deno task test
deno task check  # format, lint, types, docs
deno task ci
deno task fix    # format and autofix lint
```

The package name is `@phughesmcr/deno-project-template`. Change `name` in `deno.json` before publishing somewhere else.

## Agents

[`AGENTS.md`](./AGENTS.md) holds the project rules for any coding agent. Claude Code also picks up [`.claude/`](./.claude):

- `settings.json` — Opus 5.5 at `medium` effort, auto-compact at 300k tokens, a status line (model, branch, context, cost, 5-hour limit), permissions for `deno`, everyday `git` and read-only `gh` commands, and the hooks below. Personal overrides go in the untracked `settings.local.json`.
- `hooks/hook.ts`:
  - At session start, injects a map of the exports in `src/`, plus the previous session's `.claude/handoff.md`, which it then deletes.
  - Formats edited files.
  - Trims the output of `deno test`/`check`/`lint`, `deno task test`/`check`/`ci`, `gh run view --log` and `gh pr checks --watch` to its tail.
  - Past 250k tokens of context (`CONTEXT_BUDGET_WARN`), asks for a handoff and a `/clear`.
  - Blocks the end of a turn whose own tool calls changed files while `deno task ci` fails, at most 3 times in a row. Edits by another session or the user mid-turn don't count.
- `agents/`, each with a `maxTurns` cap:
  - `explorer` — read-only code search on Haiku at `low` effort, without loading `AGENTS.md`. It replaces the built-in Explore agent, which `settings.json` denies.
  - `simplifier` — Sonnet at `medium` effort. Makes the current diff simpler without changing behavior, adapted from the thermo-nuclear code quality review, then keeps `deno task ci` green.
  - `reviewer` — read-only reviewer on Sonnet at `medium` effort that reports only verified findings.
  - `docs-checker` — read-only Haiku check, at `medium` effort, for docs the current change made stale.
- `skills/`:
  - `/new-project` turns a fresh clone into a named project and can set up its GitHub repository: squash merges, plus a ruleset that requires CI on `main`.
  - `/slice <feature | #issue>` builds a feature test-first, then runs the simplifier, reviewer and docs-checker on the diff.
  - `/ship` takes the change through a pull request: CI, squash-merge, back to `main`.
  - `/release [patch|minor|major]` bumps, verifies and tags, then asks before pushing.

## Publish

Create the package at [jsr.io](https://jsr.io), then push a `v*` tag. [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) runs the checks, `deno publish` (using GitHub OIDC for provenance) and creates a GitHub release with generated notes.

```sh
deno publish --dry-run
```

`deno bump-version patch` updates the version in `deno.json`.
