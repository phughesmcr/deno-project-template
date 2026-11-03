# Project Guidance

This is a personal experimental project. Ship the smallest working slice that meets the request, then add the next capability on a product that already works. Make durable architectural choices after a slice works, never by trading a working product for unfinished complexity. Correctness, performance, and reliability gate done. Process exists to serve that outcome; it must never become the product.

Time matters here: do not spend time that can be avoided, and the earlier a correct result is obtained, the better. Three steps are never skipped, because they are what make a result correct: reading the code you will change, a test that locks the behavior, and a passing `deno task ci`.

## This project

This is the template itself: a Deno library starter with agent tooling. In a project made from it, `/new-project` replaces this section with what the project is and who uses it, its kind (library, CLI or app), domain terms, layout beyond `src/` and `tests/`, and commands beyond `deno task ci`. Keep it current as those change.

## Tech stack

- [Deno](https://docs.deno.com/) 2.9.8 — pinned in `.tool-versions`. Runtime, test runner, formatter, linter, type checker
- [@std (JSR)](https://jsr.io/@std) — assert, path, fs, encoding, front-matter, media-types, etc.
- [Deno compile](https://docs.deno.com/reference/cli/compile/) — binary compilation when shipping a CLI or app
- Prefer Web Platform APIs and Deno APIs available on the pinned Deno version

Dependency order: Web/Deno/`@std` → existing project deps → a well-maintained package → hand-roll only with a clear reason. Check docs and types before assuming a library lacks a capability. Add packages to `deno.json` `imports` deliberately.

If this project grows into a web or desktop app, prefer [Deno Fresh](https://usefresh.dev/docs/introduction) and [Deno Desktop](https://docs.deno.com/runtime/desktop/) over inventing a framework.

## Working on a request

- Carry out the simplest reading of the request that fully meets it. When a simpler approach than the one asked for meets it, implement that and say so. Name a non-obvious assumption in the same message as your next action.
- Ask only when nothing further can move without the user, or before a risky or destructive action, and name the blocker. A choice that does not block the rest of the work is not a stop: take the simplest option and continue.
- Name the check, then meet it. "Add validation" → tests for the invalid inputs, then make them pass. "Fix the bug" → a test that reproduces it, then the fix. "Refactor X" → tests pass before and after. If the request names no check, use this repo's: the change typechecks, tests cover the behavior, and `deno task ci` passes.
- For a task with several parts, keep a short checklist and update it as each part finishes. A turn that ends with open items and no blocker leaves the work undone, so start the next open part in the same turn. Don't end a turn with a summary that announces the next step instead of taking it, or with an offer to carry on.
- Ground what you say in what you read. Cite `path:line` for claims about this code. Before relying on a Deno, Web or `@std` API you are not certain of, check its signature with `deno doc` (e.g. `deno doc jsr:@std/path/join`) or its types. If you could not verify something, say so instead of guessing.
- With the first tool call, write one line on what you are doing, in the same message as the call. When the work is finished, and only then, recap what changed, how you checked it, and anything still open.
- Iterate with `deno task check` and targeted tests. Run `deno task ci` (format, lint, types, doc lint, tests) before calling the work done; in Claude Code the Stop hook also runs it when the turn changed files and blocks the turn while it fails.
- Request only the Deno permissions the code needs; don't widen `--allow-*` casually.

## Delivery integrity

- **No process or ceremony for its own sake.** Certificates, ledgers, dashboards, meta-reports, and paperwork are not progress unless they are a hard gate for a named feature.
- **Feature-first.** Almost all open work must deliver runnable behavior an end user or consuming agent can exercise. Process/ops items must name the feature they gate; ungated process work does not get created.
- **Honesty is absolute.** Never fake a test, present a fixture or mock as live proof, weaken an assertion to make it pass, hard-code a success path, or close work that is not done. If a test or requirement looks wrong, say so instead of working around it.
- **Refusal is not delivery.** A correctly typed refusal beats a fabricated result, but implementing only the refusal path never closes a feature. Mark refusal-only states explicitly and leave a follow-up for the real capability.

## Code style

`deno lint` (with the plugin in `lint/plugin.ts`) enforces the layout rules, so a violation fails CI: TypeScript lives in `src/`, `tests/`, or `.claude/hooks/` (hook scripts are tested like source); file and directory names are `snake_case`; barrels are `mod.ts`, never `index.ts`; tests are `tests/**/*.test.ts`; top-level functions are `function` declarations, not `const` arrows; there are no namespace imports (`import * as ...`), because they defeat tree-shaking for `deno compile`. The compiler rejects unused locals and parameters. Formatting rules live in `deno.json`; `deno task fix` applies them.

- Strict, functional TypeScript. Prefer data-driven design: plain data + functions over class hierarchies.
- Imports are named and carry the `.ts` extension, e.g. `import { spawnThing } from "../play/spawn.ts"`.
- Function names describe what they do, not where they live — the directory already says where, so no subsystem prefixes.
- Use modern APIs where relevant (`Promise.try`, `Disposable` / `AsyncDisposable`, etc.) — only APIs available on the pinned Deno version.
- Unreleased and pre-1.0 surfaces carry no backward compatibility: remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations. Once released, the `exports` in `deno.json` are a contract.

### Simplicity

Write the minimum code that solves the problem; every speculative line is code someone must read, test, and later delete.

- No features, flexibility, or configuration beyond what was asked.
- No error handling for impossible scenarios. Validate where data crosses a trust boundary.
- If you write 200 lines and it could be 50, rewrite it.
- Prefer a plain function and a plain data structure over factories, builders, a class with one method, interfaces, DI containers, or "manager" layers. Write the direct version first and introduce an abstraction when a second real caller needs it, not in anticipation of one.

### Surgical changes

Every changed line traces to the request, or is dead code being removed. In working code, match the existing style and leave adjacent code, comments, and formatting alone, even where you would do it differently; don't refactor what isn't broken. Dead code is not protected: delete it when you find it (yours or pre-existing), and always delete the imports, variables, and functions your change orphans.

### Encode intent in types, not comments

Use the type system as documentation. Name constants. Model states as discriminated unions so illegal states are unrepresentable: `{ kind: "ok"; value: string } | { kind: "err"; error: string }`, not `{ kind: number; value?: string; error?: string }`. Use a schema library (e.g. Zod) where data crosses a trust boundary — config, user input, persisted files, external payloads.

Rule: no bare numeric/string codes where a union or named constant fits. No optional field that's "only set when kind is X" — split the type. Switches over unions must be exhaustive: `default: { const _exhaustive: never = value; return _exhaustive; }`.

### Keep hot paths allocation-light

When a loop is genuinely hot (tight parse/transform, streaming, per-frame work in an app), allocate buffers once (e.g. one `Float32Array` per field) and mutate in place instead of `map`ping to fresh objects each iteration. Cold paths — startup, per-request setup, tests — may allocate freely.
