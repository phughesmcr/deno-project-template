# deno-project-template

Deno 2.9 library, set up the way [`deno init --lib`](https://docs.deno.com/runtime/getting_started/first_project/) does it: one entrypoint, a colocated test, and a lockfile. The toolchain is pinned to Deno 2.9.8 in [`.tool-versions`](./.tool-versions).

```sh
deno task dev    # tests, rerun on save
deno task test
deno task check  # format, lint, types, docs
deno task ci
deno task fix    # format and autofix lint
```

The package name is `@phughesmcr/deno-project-template`. Change `name` in `deno.json` before publishing somewhere else.

## Publish

Create the package at [jsr.io](https://jsr.io), then push a `v*` tag. [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) runs the checks and `deno publish`, using GitHub OIDC for provenance.

```sh
deno publish --dry-run
```

`deno bump-version patch` updates the version in `deno.json`.
