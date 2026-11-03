---
name: slice
description: Build one feature as the smallest working end-to-end slice, test first, through to a green `deno task ci`.
argument-hint: <feature> | #issue
disable-model-invocation: true
---

Build this feature as the smallest slice an end user can exercise: $ARGUMENTS

If that is an issue (`#N` or an issue URL), read it with `gh issue view N --comments` and build what it asks; `/ship` then closes it.

1. Read the code you will change and its callers. For any Deno, Web or `@std` API you are not certain of on the pinned Deno version, check its signature with `deno doc` (for example `deno doc jsr:@std/path/join`) before using it.
2. Write the test first in `tests/`, exercising the behavior the way a caller would. Run `deno task test` and confirm it fails for the reason you expect, not an import or type error.
3. Write the least code in `src/` that passes it. If `deno.json` has `exports`, public API goes through that entry point with a JSDoc comment.
4. Run `deno task ci` and fix what it reports.
5. If the diff is more than a few lines, run the `reviewer` subagent on it. Fix confirmed bugs and test gaps; say which findings you rejected and why.
6. Finish with: what now works and how to run it, how you checked it, and the next slice worth building.
