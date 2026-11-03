const segment = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function relativePath(filename: string): string {
  const norm = filename.replaceAll("\\", "/");
  const cwd = Deno.cwd().replaceAll("\\", "/").replace(/\/$/, "");
  const prefix = `${cwd}/`;
  return norm.startsWith(prefix) ? norm.slice(prefix.length) : norm;
}

function layoutProblem(filename: string): string | undefined {
  const rel = relativePath(filename);
  if (!rel.endsWith(".ts") || rel === "lint/plugin.ts") return undefined;
  const parts = rel.split("/");
  const root = parts[0];
  const file = parts.at(-1);
  if (root !== "src" && root !== "tests" || file === undefined) {
    return "TypeScript files belong in src/ or tests/.";
  }
  for (const dir of parts.slice(1, -1)) {
    if (!segment.test(dir)) {
      return `Directory "${dir}" must be snake_case.`;
    }
  }
  if (file === "index.ts") return "Barrels are mod.ts, never index.ts.";
  if (root === "tests") {
    if (!file.endsWith(".test.ts")) return "Tests are named *.test.ts.";
    const stem = file.slice(0, -".test.ts".length);
    if (!segment.test(stem)) {
      return `Filename "${file}" must be snake_case.`;
    }
    return undefined;
  }
  if (file.endsWith(".test.ts")) {
    return "Tests live in tests/ and are named *.test.ts.";
  }
  const stem = file.slice(0, -".ts".length);
  if (!segment.test(stem)) {
    return `Filename "${file}" must be snake_case.`;
  }
  return undefined;
}

function isFunctionValue(
  node: Deno.lint.Node | null | undefined,
): boolean {
  return node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression";
}

function isTopLevel(node: Deno.lint.VariableDeclarator): boolean {
  const declaration = node.parent;
  if (declaration?.type !== "VariableDeclaration") return false;
  const scope = declaration.parent;
  if (scope?.type === "Program") return true;
  return scope?.type === "ExportNamedDeclaration" &&
    scope.parent?.type === "Program";
}

const plugin: Deno.lint.Plugin = {
  name: "project",
  rules: {
    layout: {
      create(context) {
        return {
          Program(node) {
            const message = layoutProblem(context.filename);
            if (message !== undefined) context.report({ node, message });
          },
        };
      },
    },
    "no-namespace-import": {
      create(context) {
        return {
          ImportNamespaceSpecifier(node) {
            context.report({
              node,
              message:
                "Use a named import. Namespace imports defeat tree-shaking for deno compile.",
            });
          },
        };
      },
    },
    "top-level-function": {
      create(context) {
        return {
          VariableDeclarator(node) {
            if (!isFunctionValue(node.init) || !isTopLevel(node)) return;
            context.report({
              node,
              message: "Top-level functions must be function declarations.",
            });
          },
          ExportDefaultDeclaration(node) {
            if (!isFunctionValue(node.declaration)) return;
            context.report({
              node,
              message: "Top-level functions must be function declarations.",
            });
          },
        };
      },
    },
  },
};

export default plugin;
