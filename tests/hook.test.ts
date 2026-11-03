import { assertEquals, assertStringIncludes } from "@std/assert";
import settings from "../.claude/settings.json" with { type: "json" };
import {
  type CiResult,
  codebaseMap,
  contextTokens,
  decideStop,
  filterCommand,
  MAX_BLOCKS,
  statusLine,
  toolchainWarning,
} from "../.claude/hooks/hook.ts";

const HOOK_SOURCE = new URL("../.claude/hooks/hook.ts", import.meta.url);

function ci(result: CiResult): { run: () => Promise<CiResult>; calls: number } {
  const counter = {
    calls: 0,
    run(): Promise<CiResult> {
      counter.calls++;
      return Promise.resolve(result);
    },
  };
  return counter;
}

async function sh(
  script: string,
  options: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
): Promise<{ code: number; stdout: string }> {
  const child = new Deno.Command("bash", {
    args: ["-c", script],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(options.stdin ?? ""));
  await writer.close();
  const out = await child.output();
  return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
}

/** A git project holding a copy of the hook and a stub `ci` task. */
async function makeProject(): Promise<{
  root: string;
  hook: (
    event: keyof typeof settings.hooks,
    index: number,
    input: Record<string, unknown>,
  ) => Promise<{ code: number; stdout: string }>;
}> {
  const tmp = await Deno.makeTempDir();
  const root = `${tmp}/project`;
  await Deno.mkdir(`${root}/.claude/hooks`, { recursive: true });
  await Deno.copyFile(HOOK_SOURCE, `${root}/.claude/hooks/hook.ts`);
  await Deno.writeTextFile(
    `${root}/deno.json`,
    JSON.stringify({ tasks: { ci: "echo CI-MARKER && exit 1" } }),
  );
  await sh(
    "git init -q && git add -A && git -c user.name=t -c user.email=t@t " +
      "-c commit.gpgsign=false commit -qm init",
    { cwd: root },
  );
  return {
    root,
    hook(event, index, input) {
      const command = settings.hooks[event][index]?.hooks[0]?.command ?? "";
      return sh(command, {
        cwd: root,
        env: { CLAUDE_PROJECT_DIR: root, TMPDIR: `${tmp}/t` },
        stdin: JSON.stringify({ session_id: "s1", ...input }),
      });
    },
  };
}

Deno.test(function toolchainWarningOnlyOnMismatch() {
  assertEquals(toolchainWarning("deno 2.9.8\n", "2.9.8"), undefined);
  assertEquals(toolchainWarning("nodejs 22\n", "2.9.8"), undefined);
  assertEquals(toolchainWarning("", "2.9.8"), undefined);
  assertStringIncludes(
    toolchainWarning("nodejs 22\ndeno 2.9.8\n", "2.8.0") ?? "",
    "Deno on PATH is 2.8.0, but .tool-versions pins 2.9.8.",
  );
});

Deno.test(function filterCommandWrapsKnownCommands() {
  const wrapped = filterCommand("deno task ci");
  assertStringIncludes(wrapped ?? "", '{ deno task ci; } > "$log" 2>&1');
  for (
    const command of [
      "deno test",
      "deno test tests/mod.test.ts",
      'deno task test --filter "adds two"',
      "deno lint src/",
      "deno check src/mod.ts",
      "gh pr checks --watch",
    ]
  ) {
    assertStringIncludes(filterCommand(command) ?? "", `{ ${command}; }`);
  }
  assertStringIncludes(
    filterCommand("gh run view 123 --log-failed") ?? "",
    "then tail -n 150",
  );
  for (
    const command of [
      "deno task ci --watch",
      "deno task dev",
      "deno test && git push",
      "deno test | head",
      "deno test $(ls)",
      "deno test # all",
      "deno test foo\\",
      "deno testing",
      "gh pr checks 3",
      "gh run view 123",
      "git status",
    ]
  ) {
    assertEquals(filterCommand(command), undefined, command);
  }
});

Deno.test(async function filterCommandKeepsExitCodeAndTail() {
  const script = filterCommand("deno test")?.replace(
    "{ deno test; }",
    "{ seq 1 200; (exit 3); }",
  );
  const out = await sh(script ?? "");
  assertEquals(out.code, 3);
  assertEquals(out.stdout.startsWith("101\n"), true);
  assertStringIncludes(out.stdout, "\n200\n");
  assertStringIncludes(out.stdout, "exit code: 3");
});

Deno.test(function contextTokensReadsLastUsage() {
  const lines = [
    JSON.stringify({ message: { usage: { input_tokens: 1 } } }),
    JSON.stringify({
      message: {
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 3000,
        },
      },
    }),
    JSON.stringify({ type: "user" }),
    "{truncated",
    "",
  ];
  assertEquals(contextTokens(lines), 3210);
  assertEquals(contextTokens([]), 0);
});

Deno.test(function codebaseMapListsExportsWithinBudget() {
  const doc = JSON.stringify({
    nodes: {
      "file:///p/src/mod.ts": {
        symbols: [
          {
            name: "add",
            declarations: [{
              kind: "function",
              def: { params: [{ name: "a" }, { name: "b" }, {}] },
            }],
          },
          { name: "Point", declarations: [{ kind: "typeAlias" }] },
        ],
      },
      "file:///p/src/a%20b.ts": { symbols: [{ name: "x" }] },
    },
  });
  const map = codebaseMap(doc, "/p", 2000).split("\n");
  assertEquals(map.slice(1), [
    "src/a b.ts: x",
    "src/mod.ts: add(a, b, …), Point",
  ]);
  const tight = codebaseMap(doc, "/p", (map[0] ?? "").length + 20).split("\n");
  assertEquals(tight.slice(1), ["src/a b.ts: x", "… and 1 more files"]);
  assertEquals(codebaseMap(JSON.stringify({ nodes: {} }), "/p", 2000), "");
});

Deno.test(function statusLineShowsContextCostAndHandoff() {
  const status = {
    model: "Opus 5.5",
    branch: "main",
    tokens: 82_400,
    percent: 8.2,
    cost: 0.4249,
    fiveHour: 23.5,
    budget: 250_000,
  };
  assertEquals(
    statusLine(status),
    "Opus 5.5 · main · 82k ctx (8%) · $0.42 · 5h 24%",
  );
  assertEquals(
    statusLine({
      ...status,
      branch: "",
      tokens: 260_000,
      percent: undefined,
      fiveHour: undefined,
    }),
    "Opus 5.5 · 260k ctx · $0.42 · over 250k: hand off",
  );
});

Deno.test(async function stopSkipsCiWhenTurnChangedNothing() {
  const fake = ci({ ok: false, output: "boom" });
  const turn = { changed: false, blocks: 0, stopHookActive: false };
  const result = await decideStop(turn, fake.run);
  assertEquals(result, { blocks: 0, decision: { kind: "allow" } });
  assertEquals(fake.calls, 0);
});

Deno.test(async function stopAllowsWhenCiPasses() {
  const turn = { changed: true, blocks: 2, stopHookActive: true };
  const result = await decideStop(turn, ci({ ok: true }).run);
  assertEquals(result, { blocks: 0, decision: { kind: "allow" } });
});

Deno.test(async function stopBlocksWithCiTailWhenCiFails() {
  const output = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
  const turn = { changed: true, blocks: 0, stopHookActive: false };
  const result = await decideStop(turn, ci({ ok: false, output }).run);
  assertEquals(result.blocks, 1);
  if (result.decision.kind !== "block") throw new Error("expected block");
  assertStringIncludes(result.decision.reason, "line 49");
  assertEquals(result.decision.reason.includes("line 9\n"), false);
});

Deno.test(async function stopGivesUpAfterMaxBlocks() {
  const failing = ci({ ok: false, output: "boom" });
  const turn = { changed: true, blocks: MAX_BLOCKS, stopHookActive: true };
  const result = await decideStop(turn, failing.run);
  assertEquals(result, { blocks: 0, decision: { kind: "allow" } });
  assertEquals(failing.calls, 0);
});

Deno.test(async function stopResetsBlocksOnFreshTurn() {
  const turn = { changed: true, blocks: MAX_BLOCKS, stopHookActive: false };
  const result = await decideStop(turn, ci({ ok: false, output: "" }).run);
  assertEquals(result.blocks, 1);
});

Deno.test(async function hookWarnsAtSessionStartOnToolchainMismatch() {
  const { root, hook } = await makeProject();
  const start = () =>
    hook("SessionStart", 0, { hook_event_name: "SessionStart" });
  await Deno.writeTextFile(`${root}/.tool-versions`, "deno 0.0.1\n");
  const output = JSON.parse((await start()).stdout).hookSpecificOutput;
  assertEquals(output.hookEventName, "SessionStart");
  assertStringIncludes(output.additionalContext, "pins 0.0.1");
  await Deno.writeTextFile(
    `${root}/.tool-versions`,
    `deno ${Deno.version.deno}\n`,
  );
  assertEquals(await start(), { code: 0, stdout: "" });
});

Deno.test(async function hookLoadsHandoffOnceAndMapsSource() {
  const { root, hook } = await makeProject();
  const start = async () =>
    JSON.parse(
      (await hook("SessionStart", 0, { hook_event_name: "SessionStart" }))
        .stdout,
    ).hookSpecificOutput.additionalContext;
  await Deno.writeTextFile(
    `${root}/.tool-versions`,
    `deno ${Deno.version.deno}\n`,
  );
  await Deno.mkdir(`${root}/src`);
  await Deno.writeTextFile(
    `${root}/src/mod.ts`,
    "/** Doubles. */\nexport function double(n: number): number {\n" +
      "  return n * 2;\n}\n",
  );
  await Deno.writeTextFile(`${root}/.claude/handoff.md`, "NEXT: add halve\n");
  const first: string = await start();
  assertStringIncludes(first, "NEXT: add halve");
  assertStringIncludes(first, "\nsrc/mod.ts: double(n)");
  const second: string = await start();
  assertEquals(second.includes("NEXT"), false);
  assertStringIncludes(second, "\nsrc/mod.ts: double(n)");
});

Deno.test(async function statusLineCommandPrintsOneLine() {
  const { root } = await makeProject();
  const out = await sh(settings.statusLine.command, {
    cwd: root,
    env: { CLAUDE_PROJECT_DIR: root },
    stdin: JSON.stringify({
      model: { display_name: "Opus 5.5" },
      workspace: { project_dir: root },
      context_window: { total_input_tokens: 1500, used_percentage: 1 },
      cost: { total_cost_usd: 0.1 },
    }),
  });
  assertEquals(out.code, 0);
  assertEquals(out.stdout.trim().split(" · ").slice(-2), [
    "2k ctx (1%)",
    "$0.10",
  ]);
});

Deno.test(async function hookRewritesFilteredBashCommands() {
  const { hook } = await makeProject();
  const out = await hook("PreToolUse", 0, {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "deno task ci", description: "CI" },
  });
  const output = JSON.parse(out.stdout).hookSpecificOutput;
  assertEquals(output.hookEventName, "PreToolUse");
  assertEquals(output.permissionDecision, "allow");
  assertEquals(output.updatedInput.description, "CI");
  assertEquals(output.updatedInput.command, filterCommand("deno task ci"));
  const ignored = await hook("PreToolUse", 0, {
    tool_input: { command: "ls" },
  });
  assertEquals(ignored, { code: 0, stdout: "" });
});

Deno.test(async function hookWarnsOnceOverContextBudget() {
  const { root, hook } = await makeProject();
  const transcript = `${root}/../transcript.jsonl`;
  await Deno.writeTextFile(
    transcript,
    JSON.stringify({ message: { usage: { input_tokens: 260_000 } } }),
  );
  const first = await hook("UserPromptSubmit", 0, {
    hook_event_name: "UserPromptSubmit",
    transcript_path: transcript,
  });
  const output = JSON.parse(first.stdout).hookSpecificOutput;
  assertEquals(output.hookEventName, "UserPromptSubmit");
  assertStringIncludes(output.additionalContext, "~260k tokens");
  const again = await hook("PostToolUse", 1, {
    hook_event_name: "PostToolUse",
    transcript_path: transcript,
  });
  assertEquals(again, { code: 0, stdout: "" });
});

Deno.test(async function hookGatesStopOnCiOnlyAfterTurnChanges() {
  const { root, hook } = await makeProject();
  const prompt = () =>
    hook("UserPromptSubmit", 0, { hook_event_name: "UserPromptSubmit" });
  const stop = (active: boolean) =>
    hook("Stop", 0, { hook_event_name: "Stop", stop_hook_active: active });

  await prompt();
  assertEquals(await stop(false), { code: 0, stdout: "" });

  // A Bash-style edit, no Edit/Write hook involved.
  await Deno.writeTextFile(`${root}/new.ts`, "export const x = 1;\n");
  const blocked = JSON.parse((await stop(false)).stdout);
  assertEquals(blocked.decision, "block");
  assertStringIncludes(blocked.reason, "CI-MARKER");
  for (let i = 1; i < MAX_BLOCKS; i++) {
    assertEquals(JSON.parse((await stop(true)).stdout).decision, "block");
  }
  assertEquals(await stop(true), { code: 0, stdout: "" });

  // The next turn changes nothing, so CI is not consulted.
  await prompt();
  assertEquals(await stop(false), { code: 0, stdout: "" });
});

Deno.test(async function hookFailsOpenOnBadInput() {
  const { root, hook } = await makeProject();
  assertEquals(await hook("Stop", 0, { session_id: "../.." }), {
    code: 0,
    stdout: "",
  });
  const command = settings.hooks.Stop[0]?.hooks[0]?.command ?? "";
  assertEquals(
    await sh(command, {
      cwd: root,
      env: { CLAUDE_PROJECT_DIR: root },
      stdin: "not json",
    }),
    {
      code: 0,
      stdout: "",
    },
  );
});
