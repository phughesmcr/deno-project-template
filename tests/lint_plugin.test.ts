import { assertEquals } from "@std/assert";
import plugin from "../lint/plugin.ts";

const clean = `export function add(a: number, b: number): number {
  return a + b;
}
`;

function problems(filename: string, source: string): string[] {
  return Deno.lint.runPlugin(plugin, filename, source).map((item) =>
    item.message
  );
}

Deno.test(function layoutRule() {
  assertEquals(problems("src/mod.ts", clean), []);
  assertEquals(problems(`${Deno.cwd()}/src/play/spawn.ts`, clean), []);
  assertEquals(problems("tests/mod.test.ts", clean), []);
  assertEquals(problems("lint/plugin.ts", clean), []);
  assertEquals(problems(".claude/hooks/hook.ts", clean), []);
  assertEquals(problems(".claude/hooks/Hook.ts", clean), [
    'Filename "Hook.ts" must be snake_case.',
  ]);
  assertEquals(problems("src/index.ts", clean), [
    "Barrels are mod.ts, never index.ts.",
  ]);
  assertEquals(problems("src/Bad.ts", clean), [
    'Filename "Bad.ts" must be snake_case.',
  ]);
  assertEquals(problems("src/my-file.ts", clean), [
    'Filename "my-file.ts" must be snake_case.',
  ]);
  assertEquals(problems("src/Play/spawn.ts", clean), [
    'Directory "Play" must be snake_case.',
  ]);
  assertEquals(problems("tests/mod.ts", clean), [
    "Tests are named *.test.ts.",
  ]);
  assertEquals(problems("src/foo.test.ts", clean), [
    "Tests live in tests/ and are named *.test.ts.",
  ]);
  assertEquals(problems("other/file.ts", clean), [
    "TypeScript files belong in src/, tests/ or .claude/hooks/.",
  ]);
  assertEquals(problems(".claude/other.ts", clean), [
    "TypeScript files belong in src/, tests/ or .claude/hooks/.",
  ]);
});

Deno.test(function namespaceImportRule() {
  const source = `import * as path from "@std/path";
export function add(a: number): number {
  return a;
}
`;
  assertEquals(problems("src/mod.ts", source), [
    "Use a named import. Namespace imports defeat tree-shaking for deno compile.",
  ]);
});

Deno.test(function topLevelFunctionRule() {
  assertEquals(
    problems("src/mod.ts", "export const add = (a: number): number => a;\n"),
    ["Top-level functions must be function declarations."],
  );
  assertEquals(
    problems(
      "src/mod.ts",
      "const add = function add(a: number): number {\n  return a;\n};\n",
    ),
    ["Top-level functions must be function declarations."],
  );
  assertEquals(
    problems("src/mod.ts", "export default () => 1;\n"),
    ["Top-level functions must be function declarations."],
  );
  assertEquals(
    problems(
      "src/mod.ts",
      "export function make(): () => number {\n  const step = () => 1;\n  return step;\n}\n",
    ),
    [],
  );
});
