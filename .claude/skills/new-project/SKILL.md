---
name: new-project
description: Turn a fresh clone of this template into a named project - identity, project kind, and the AGENTS.md project section. Run once, right after cloning.
argument-hint: [one-line description]
disable-model-invocation: true
---

Set up this clone as a new project. The user's description, if any: $ARGUMENTS

1. Read `git remote get-url origin` for the GitHub owner and repo. If `git log` still shows this template's history, ask whether to start fresh history (`rm -rf .git && git init`); it is destructive, so do nothing without a yes.
2. Ask in one AskUserQuestion call, offering defaults:
   - JSR name `@scope/name` (default `@<owner>/<repo>`).
   - One-line description (default: $ARGUMENTS).
   - Kind: library published to JSR; CLI compiled with `deno compile`, and whether it is also published to JSR; or web app on Fresh, which is never published to JSR.
   - Only if the owner is not `phughesmcr`: the author's name, email and URL.
   - Only if `gh repo view` succeeds: whether to set up the GitHub repository for `/ship` (default yes).
3. Kind. Do this before the identity step, because Fresh's init overwrites files.
   - Library: nothing more.
   - CLI: add `src/main.ts` with its work behind `if (import.meta.main)`. Add a `start` task and a `compile` task (`deno compile --output dist/<name>` with only the `--allow-*` flags the CLI needs). Add `src/main.ts` to the `deno check` in the `check` task. If it is published, set `exports` to `./src/main.ts` and point `deno doc --lint` at it, so `deno run jsr:@scope/name` runs the CLI.
   - Web app: get Fresh's current init command from https://usefresh.dev/docs/introduction rather than from memory. Run it in an empty scratch directory, never here: it refuses a non-empty folder and replaces `deno.json`, `.gitignore` and `README.md` outright. Copy its app files in, except those three, then merge:
     - `deno.json`: add Fresh's `imports`, `tasks` and `compilerOptions` entries; keep every key already here, including the `test` task, `@std/assert`, `test.include` and `minimumDependencyAge`.
     - `.gitignore`: append Fresh's lines.
     - `lint/plugin.ts`: `.tsx` files already pass the layout rule. Add the root-level `.ts` files Fresh generated (such as `main.ts`, `client.ts`, `utils.ts`, `vite.config.ts`) to an exact-name exception next to `lint/plugin.ts`, with a case for each in `tests/lint_plugin.test.ts`.
   - Not published (Fresh, or a CLI not published to JSR): remove `exports`, the `publish` block, `deno doc --lint` from `check`, `deno publish --dry-run` from `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `.claude/skills/release/`, and the README's Publish section and `/release` mention.
4. Identity, every kind:
   - `deno.json`: `name`, `description`, and `version` `0.0.0`.
   - `README.md`: title and first paragraph.
   - `SECURITY.md` and `SUPPORT.md`: links to `https://github.com/<owner>/<repo>`.
   - `LICENSE`: the current year.
   - A different owner: `@<owner>` in `.github/CODEOWNERS` and `.github/FUNDING.yml`, the author in `AUTHORS.md`, and the copyright holder in `LICENSE`.
   - Then `git grep -n -e deno-project-template -e phughesmcr` (it includes dot-directories) and update every remaining hit that names the template or its owner.
5. Replace the "This project" section of `AGENTS.md` with what is true now, in under 15 lines: what the project is and who uses it, its kind, domain terms, layout beyond `src/` and `tests/`, and commands beyond `deno task ci`. Leave out anything not yet decided.
6. Keep `add` and its test until the first real slice replaces them. Delete `.claude/skills/new-project/` and its mention in the README.
7. GitHub, only if the user said yes in step 2. Run `gh repo edit --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge` so `/ship` merges stay linear and clean up their branch. Then add a ruleset that protects `main`: CI must pass before a merge, and it can't be force-pushed or deleted. Admins bypass it, so `/release` can still push its version commit. Create it with `gh api repos/<owner>/<repo>/rulesets --method POST --input -` and this body:

   ```json
   {
     "name": "main",
     "target": "branch",
     "enforcement": "active",
     "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
     "bypass_actors": [{ "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always" }],
     "rules": [
       { "type": "deletion" },
       { "type": "non_fast_forward" },
       {
         "type": "required_status_checks",
         "parameters": {
           "strict_required_status_checks_policy": false,
           "required_status_checks": [{ "context": "ci" }]
         }
       }
     ]
   }
   ```

   `ci` is the job name in `.github/workflows/ci.yml`; change it here if that job is renamed. Actor `5` is the repository admin role. GitHub refuses rulesets on private repositories on the free plan: if the call fails, say why and carry on.
8. Run `deno task ci` and fix what it reports. Leave the changes uncommitted. Finish with what changed, what you assumed, and a suggested first `/slice`.
