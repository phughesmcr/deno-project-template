import { assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

// Claude Code ignores unknown frontmatter fields without an error, so a typo
// such as `maxturns` silently drops the setting. These lists follow
// https://code.claude.com/docs/en/sub-agents and /skills.
const AGENT_FIELDS = new Set([
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "permissionMode",
  "maxTurns",
  "autoCompactWindow",
  "skills",
  "mcpServers",
  "hooks",
  "memory",
  "background",
  "omitClaudeMd",
  "effort",
  "isolation",
  "color",
  "initialPrompt",
  "experimental",
]);
const SKILL_FIELDS = new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell",
  "metadata",
  "license",
  "compatibility",
]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const MODELS = new Set([
  "sonnet",
  "opus",
  "haiku",
  "fable",
  "inherit",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-fable-5-1",
]);
const COLORS = new Set([
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
]);
const STRING_FIELDS = [
  "name",
  "description",
  "tools",
  "model",
  "effort",
  "color",
  "argument-hint",
];
const TOOLS = new Set(["Read", "Grep", "Glob", "Bash", "Edit", "Write"]);
const CLAUDE_DIR = new URL("../.claude/", import.meta.url);

/** A Markdown file's frontmatter, parsed as YAML the way Claude Code reads it. */
function frontmatter(text: string): Map<string, unknown> {
  const block = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  const fields = parse(block);
  return new Map(
    typeof fields === "object" && fields !== null ? Object.entries(fields) : [],
  );
}

async function markdownFiles(
  dir: string,
  pick: (entry: Deno.DirEntry) => string | undefined,
): Promise<{ name: string; fields: Map<string, unknown> }[]> {
  const files = [];
  for await (const entry of Deno.readDir(new URL(dir, CLAUDE_DIR))) {
    const path = pick(entry);
    if (path === undefined) continue;
    const text = await Deno.readTextFile(new URL(`${dir}${path}`, CLAUDE_DIR));
    files.push({
      name: path.split(/[./]/)[0] ?? "",
      fields: frontmatter(text),
    });
  }
  return files;
}

function assertSettings(fields: Map<string, unknown>, file: string): void {
  for (const key of STRING_FIELDS) {
    if (fields.has(key)) assertEquals(typeof fields.get(key), "string", file);
  }
  const check = (key: string, allowed: Set<unknown>) => {
    if (fields.has(key)) {
      assertEquals(allowed.has(fields.get(key)), true, `${file}: ${key}`);
    }
  };
  check("model", MODELS);
  check("effort", EFFORTS);
  check("color", COLORS);
}

Deno.test(async function agentsUseKnownFrontmatter() {
  const agents = await markdownFiles(
    "agents/",
    (entry) => entry.name.endsWith(".md") ? entry.name : undefined,
  );
  assertEquals(agents.length > 0, true);
  for (const { name, fields } of agents) {
    const file = `agents/${name}.md`;
    assertEquals(
      [...fields.keys()].filter((k) => !AGENT_FIELDS.has(k)),
      [],
      file,
    );
    assertEquals(fields.get("name"), name, file);
    assertEquals(fields.has("description"), true, file);
    assertEquals(Number(fields.get("maxTurns")) > 0, true, file);
    const tools = String(fields.get("tools") ?? "").split(/,\s*/);
    assertEquals(tools.filter((t) => !TOOLS.has(t)), [], file);
    assertSettings(fields, file);
  }
});

Deno.test(async function skillsUseKnownFrontmatter() {
  const skills = await markdownFiles(
    "skills/",
    (entry) => entry.isDirectory ? `${entry.name}/SKILL.md` : undefined,
  );
  assertEquals(skills.length > 0, true);
  for (const { name, fields } of skills) {
    const file = `skills/${name}/SKILL.md`;
    assertEquals(
      [...fields.keys()].filter((k) => !SKILL_FIELDS.has(k)),
      [],
      file,
    );
    assertEquals(fields.get("name"), name, file);
    assertEquals(fields.has("description"), true, file);
    assertSettings(fields, file);
  }
});
