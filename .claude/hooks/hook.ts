// Claude Code hooks, wired in .claude/settings.json:
// filter | format | budget | prompt | stop

type Mode = "filter" | "format" | "budget" | "prompt" | "stop";

type HookInput = {
  sessionId: string;
  event: string;
  transcriptPath: string;
  stopHookActive: boolean;
  toolInput: Record<string, unknown>;
};

/** Result of `deno task ci`. */
export type CiResult = { ok: true } | { ok: false; output: string };

/** Whether the Stop hook lets the turn end. */
export type StopDecision =
  | { kind: "allow" }
  | { kind: "block"; reason: string };

/** Continuations allowed per turn before a failing turn may end anyway. */
export const MAX_BLOCKS = 3;
const CI_TAIL_LINES = 40;
const DEFAULT_BUDGET = 250_000;
const TRANSCRIPT_TAIL_BYTES = 400_000;
const FILTERED_COMMANDS = new Set([
  "deno test",
  "deno task test",
  "deno task check",
  "deno task ci",
]);

/** Wraps known test/check commands so only the output tail reaches context. */
export function filterCommand(command: string): string | undefined {
  if (!FILTERED_COMMANDS.has(command)) return undefined;
  return [
    'log=$(mktemp "${TMPDIR:-/tmp}/claude-test.XXXXXX") || exit $?',
    "code=0",
    `{ ${command}; } > "$log" 2>&1 || code=$?`,
    'if [ "$code" -eq 0 ]; then tail -n 5 "$log"; else tail -n 100 "$log"; fi',
    'printf "\\nexit code: %s (full log: %s)\\n" "$code" "$log"',
    'exit "$code"',
  ].join("\n");
}

/** Context tokens in use, from the last usage record in a transcript tail. */
export function contextTokens(lines: readonly string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    let usage: Record<string, unknown> | undefined;
    try {
      usage = JSON.parse(lines[i] ?? "")?.message?.usage;
    } catch {
      continue;
    }
    if (typeof usage !== "object" || usage === null) continue;
    return count(usage["input_tokens"]) +
      count(usage["cache_read_input_tokens"]) +
      count(usage["cache_creation_input_tokens"]);
  }
  return 0;
}

/** Decides whether the turn may end, running CI only if the turn changed files. */
export async function decideStop(
  turn: { changed: boolean; blocks: number; stopHookActive: boolean },
  runCi: () => Promise<CiResult>,
): Promise<{ blocks: number; decision: StopDecision }> {
  const blocks = turn.stopHookActive ? turn.blocks : 0;
  if (!turn.changed || blocks >= MAX_BLOCKS) {
    return { blocks: 0, decision: { kind: "allow" } };
  }
  const ci = await runCi();
  if (ci.ok) return { blocks: 0, decision: { kind: "allow" } };
  const tail = ci.output.trimEnd().split("\n").slice(-CI_TAIL_LINES).join(
    "\n",
  );
  return {
    blocks: blocks + 1,
    decision: {
      kind: "block",
      reason:
        "deno task ci is still failing, so this change is not done. Fix the " +
        "failures and re-run it. If something is blocked, say what is " +
        `blocking it.\n\n${tail}`,
    },
  };
}

function count(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function parseInput(text: string): HookInput {
  const raw: Record<string, unknown> = JSON.parse(text);
  const toolInput = raw["tool_input"];
  return {
    sessionId: String(raw["session_id"] ?? ""),
    event: String(raw["hook_event_name"] ?? ""),
    transcriptPath: String(raw["transcript_path"] ?? ""),
    stopHookActive: raw["stop_hook_active"] === true,
    toolInput: typeof toolInput === "object" && toolInput !== null ?
      toolInput as Record<string, unknown> :
      {},
  };
}

/** One file per value, so hooks running in parallel never share a file. */
function stateDir(sessionId: string): string | undefined {
  const id = sessionId.replace(/[^A-Za-z0-9_-]/g, "");
  if (id === "") return undefined;
  return `${Deno.env.get("TMPDIR") || "/tmp"}/claude-hooks/${id}`;
}

async function readState(dir: string, key: string): Promise<string> {
  try {
    return await Deno.readTextFile(`${dir}/${key}`);
  } catch {
    return "";
  }
}

async function writeState(
  dir: string,
  key: string,
  value: string,
): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/${key}`, value);
}

async function readTail(path: string): Promise<string[]> {
  using file = await Deno.open(path);
  const size = (await file.stat()).size;
  const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
  await file.seek(start, Deno.SeekMode.Start);
  const bytes = new Uint8Array(size - start);
  let read = 0;
  while (read < bytes.length) {
    const n = await file.read(bytes.subarray(read));
    if (n === null) break;
    read += n;
  }
  return new TextDecoder().decode(bytes.subarray(0, read)).split("\n");
}

async function git(projectDir: string, args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: projectDir,
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) throw new Error(`git ${args.join(" ")} failed`);
  return new TextDecoder().decode(out.stdout);
}

/** HEAD plus the mtime and size of every changed or untracked file. */
async function treeSnapshot(projectDir: string): Promise<string> {
  const [head, files] = await Promise.all([
    git(projectDir, ["rev-parse", "HEAD"]).catch(() => "no-head\n"),
    git(projectDir, ["ls-files", "-z", "-m", "-o", "--exclude-standard"]),
  ]);
  const lines = [head.trim()];
  for (const path of files.split("\0").filter(Boolean).sort()) {
    const info = await Deno.stat(`${projectDir}/${path}`).catch(() => null);
    lines.push(`${path}\t${info?.mtime?.getTime() ?? "-"}\t${info?.size ?? 0}`);
  }
  return lines.join("\n");
}

async function runCi(projectDir: string): Promise<CiResult> {
  const out = await new Deno.Command("deno", {
    args: ["task", "ci"],
    cwd: projectDir,
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.success) return { ok: true };
  const decoder = new TextDecoder();
  return {
    ok: false,
    output: decoder.decode(out.stdout) + decoder.decode(out.stderr),
  };
}

function print(value: unknown): void {
  console.log(JSON.stringify(value));
}

async function warnBudget(dir: string, input: HookInput): Promise<void> {
  if (input.transcriptPath === "" || await readState(dir, "warned")) return;
  const budget = Number(Deno.env.get("CONTEXT_BUDGET_WARN")) || DEFAULT_BUDGET;
  const used = contextTokens(await readTail(input.transcriptPath));
  if (used < budget) return;
  await writeState(dir, "warned", "1");
  print({
    hookSpecificOutput: {
      hookEventName: input.event,
      additionalContext: `Context is ~${Math.round(used / 1000)}k tokens ` +
        `(handoff rule: ${Math.round(budget / 1000)}k). Finish the ` +
        "current package at its next safe point, write a compact " +
        "handoff (inputs, state, decision, next step) and tell the user " +
        "to continue in a fresh session. Do not start new work in this one.",
    },
  });
}

async function run(mode: Mode, input: HookInput): Promise<void> {
  const projectDir = Deno.env.get("CLAUDE_PROJECT_DIR") ?? Deno.cwd();
  const dir = stateDir(input.sessionId);
  switch (mode) {
    case "filter": {
      const command = input.toolInput["command"];
      const filtered = typeof command === "string" ?
        filterCommand(command) :
        undefined;
      if (filtered === undefined) return;
      return print({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { ...input.toolInput, command: filtered },
        },
      });
    }
    case "format": {
      const file = input.toolInput["file_path"];
      if (typeof file !== "string" || !file.startsWith(`${projectDir}/`)) {
        return;
      }
      await new Deno.Command("deno", {
        args: ["fmt", "--quiet", file],
        cwd: projectDir,
        stdout: "null",
        stderr: "null",
      }).output();
      return;
    }
    case "budget": {
      if (dir !== undefined) await warnBudget(dir, input);
      return;
    }
    case "prompt": {
      if (dir === undefined) return;
      await Promise.all([
        treeSnapshot(projectDir).then((snap) => writeState(dir, "turn", snap)),
        warnBudget(dir, input),
      ]);
      return;
    }
    case "stop": {
      if (dir === undefined) return;
      const before = await readState(dir, "turn");
      const result = await decideStop({
        // No snapshot (hook added mid-session): fail open.
        changed: before !== "" && before !== await treeSnapshot(projectDir),
        blocks: Number(await readState(dir, "blocks")) || 0,
        stopHookActive: input.stopHookActive,
      }, () => runCi(projectDir));
      await writeState(dir, "blocks", String(result.blocks));
      if (result.decision.kind === "block") {
        print({ decision: "block", reason: result.decision.reason });
      }
      return;
    }
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

function isMode(value: string | undefined): value is Mode {
  return value === "filter" || value === "format" || value === "budget" ||
    value === "prompt" || value === "stop";
}

if (import.meta.main) {
  const mode = Deno.args[0];
  // A broken hook must never break the session: fail open, silently.
  try {
    if (isMode(mode)) {
      await run(
        mode,
        parseInput(await new Response(Deno.stdin.readable).text()),
      );
    }
  } catch {
    // fail open
  }
}
