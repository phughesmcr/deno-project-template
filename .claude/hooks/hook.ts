// Claude Code hooks, wired in .claude/settings.json:
// session | statusline | filter | format | budget | prompt | stop

const MODES = [
  "session",
  "statusline",
  "filter",
  "format",
  "budget",
  "prompt",
  "stop",
] as const;
type Mode = typeof MODES[number];

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
/** Characters of codebase map injected at session start. */
export const MAP_BUDGET = 2000;
const HANDOFF_FILE = ".claude/handoff.md";

/** Output lines kept from a filtered command, by exit status. */
type OutputFilter = { pattern: RegExp; okTail: number; failTail: number };

// One command with plain arguments: no chaining, pipes, redirects,
// substitutions, comments or escapes, so wrapping it cannot change what runs.
const PLAIN_ARGS = String.raw`[^;&|<>\x60$()#\\\n]*$`;
const OUTPUT_FILTERS: readonly OutputFilter[] = [
  {
    // Never --watch, which would not exit.
    pattern: new RegExp(
      String.raw`^deno (?:test|check|lint|task (?:test|check|ci))` +
        String.raw`(?:$| (?!.*--watch)${PLAIN_ARGS})`,
    ),
    okTail: 5,
    failTail: 100,
  },
  {
    pattern: new RegExp(String.raw`^gh run view (?=.*--log)${PLAIN_ARGS}`),
    okTail: 150,
    failTail: 150,
  },
  {
    pattern: new RegExp(String.raw`^gh pr checks (?=.*--watch)${PLAIN_ARGS}`),
    okTail: 20,
    failTail: 40,
  },
];

/** A warning when the running Deno is not the version `.tool-versions` pins. */
export function toolchainWarning(
  toolVersions: string,
  running: string,
): string | undefined {
  const pinned = toolVersions.match(/^deno\s+(\S+)/m)?.[1];
  if (pinned === undefined || pinned === running) return undefined;
  return `Deno on PATH is ${running}, but .tool-versions pins ${pinned}. ` +
    `Write code for ${pinned}: \`deno doc\` and \`deno check\` here reflect ` +
    `${running}, so confirm APIs against ${pinned}'s docs. Tell the user ` +
    "once, so they can switch toolchains.";
}

/** Wraps noisy check and log commands so only the output tail reaches context. */
export function filterCommand(command: string): string | undefined {
  const filter = OUTPUT_FILTERS.find((f) => f.pattern.test(command));
  if (filter === undefined) return undefined;
  const { okTail, failTail } = filter;
  return [
    'log=$(mktemp "${TMPDIR:-/tmp}/claude-test.XXXXXX") || exit $?',
    "code=0",
    `{ ${command}; } > "$log" 2>&1 || code=$?`,
    `if [ "$code" -eq 0 ]; then tail -n ${okTail} "$log"; ` +
    `else tail -n ${failTail} "$log"; fi`,
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

type DocSymbol = {
  name?: string;
  declarations?: { kind?: string; def?: { params?: { name?: string }[] } }[];
};

/** One line per source file naming its exports, from `deno doc --json`. */
export function codebaseMap(
  docJson: string,
  projectDir: string,
  budget: number,
): string {
  const nodes: Record<string, { symbols?: DocSymbol[] }> =
    JSON.parse(docJson)?.nodes ?? {};
  const lines = Object.entries(nodes).map(([url, node]) => {
    const absolute = decodeURIComponent(new URL(url).pathname);
    const path = absolute.startsWith(`${projectDir}/`) ?
      absolute.slice(projectDir.length + 1) :
      absolute;
    const names = (node.symbols ?? []).map((symbol) => {
      const declaration = symbol.declarations?.[0];
      if (declaration?.kind !== "function") return symbol.name;
      const params = (declaration.def?.params ?? []).map((p) => p.name ?? "…");
      return `${symbol.name}(${params.join(", ")})`;
    });
    return `${path}: ${names.join(", ")}`;
  }).sort();
  if (lines.length === 0) return "";
  const header = "Exports in src/ (from deno doc). Reuse these before " +
    "writing new code; read the file before relying on one:";
  const shown: string[] = [];
  let size = header.length;
  for (const line of lines) {
    if (size + line.length + 1 > budget) break;
    shown.push(line);
    size += line.length + 1;
  }
  const hidden = lines.length - shown.length;
  if (hidden > 0) shown.push(`… and ${hidden} more files`);
  return [header, ...shown].join("\n");
}

/** Live session facts for the status line. */
export type Status = {
  model: string;
  branch: string;
  tokens: number;
  percent: number | undefined;
  cost: number;
  fiveHour: number | undefined;
  budget: number;
};

/** One status line: model, branch, context, cost and the 5-hour limit. */
export function statusLine(status: Status): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const parts = [status.model];
  if (status.branch !== "") parts.push(status.branch);
  parts.push(
    `${k(status.tokens)} ctx` +
      (status.percent === undefined ? "" : ` (${Math.round(status.percent)}%)`),
    `$${status.cost.toFixed(2)}`,
  );
  if (status.fiveHour !== undefined) {
    parts.push(`5h ${Math.round(status.fiveHour)}%`);
  }
  if (status.tokens >= status.budget) {
    parts.push(`over ${k(status.budget)}: hand off`);
  }
  return parts.join(" · ");
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

/** The value at a dotted path in parsed JSON, or undefined. */
function pick(raw: unknown, path: string): unknown {
  let value = raw;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseInput(raw: Record<string, unknown>): HookInput {
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

function contextBudget(): number {
  return Number(Deno.env.get("CONTEXT_BUDGET_WARN")) || DEFAULT_BUDGET;
}

async function warnBudget(dir: string, input: HookInput): Promise<void> {
  if (input.transcriptPath === "" || await readState(dir, "warned")) return;
  const budget = contextBudget();
  const used = contextTokens(await readTail(input.transcriptPath));
  if (used < budget) return;
  await writeState(dir, "warned", "1");
  print({
    hookSpecificOutput: {
      hookEventName: input.event,
      additionalContext: `Context is ~${Math.round(used / 1000)}k tokens ` +
        `(handoff rule: ${Math.round(budget / 1000)}k). Finish the ` +
        "current package at its next safe point, then write a compact " +
        `handoff to ${HANDOFF_FILE} (inputs, state, decision, next step). ` +
        "Tell the user to run /clear: the next session loads the handoff " +
        "automatically. Do not start new work in this one.",
    },
  });
}

/** The previous session's handoff, if one is waiting. */
async function readHandoff(projectDir: string): Promise<string | undefined> {
  const text = await Deno.readTextFile(`${projectDir}/${HANDOFF_FILE}`)
    .catch(() => "");
  if (text.trim() === "") return undefined;
  return `Handoff from the previous session (${HANDOFF_FILE}, now ` +
    `deleted). Continue from it:\n\n${text.trim()}`;
}

async function sourceMap(projectDir: string): Promise<string> {
  const out = await new Deno.Command("deno", {
    args: ["doc", "--json", "src/"],
    cwd: projectDir,
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return "";
  // deno doc reports real paths (e.g. /private/var on macOS).
  return codebaseMap(
    new TextDecoder().decode(out.stdout),
    await Deno.realPath(projectDir),
    MAP_BUDGET,
  );
}

async function currentBranch(dir: string): Promise<string> {
  return (await git(dir, ["branch", "--show-current"]).catch(() => "")).trim();
}

async function run(mode: Mode, raw: Record<string, unknown>): Promise<void> {
  const projectDir = Deno.env.get("CLAUDE_PROJECT_DIR") ?? Deno.cwd();
  const input = parseInput(raw);
  switch (mode) {
    case "session": {
      const [toolVersions, handoff, map] = await Promise.all([
        Deno.readTextFile(`${projectDir}/.tool-versions`).catch(() => ""),
        readHandoff(projectDir).catch(() => undefined),
        sourceMap(projectDir).catch(() => ""),
      ]);
      const context = [
        toolchainWarning(toolVersions, Deno.version.deno),
        handoff,
        map,
      ].filter((part) => part !== undefined && part !== "").join("\n\n");
      if (context === "") return;
      print({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: context,
        },
      });
      // Only after it is printed, so a killed hook never loses the handoff.
      if (handoff !== undefined) {
        await Deno.remove(`${projectDir}/${HANDOFF_FILE}`);
      }
      return;
    }
    case "statusline": {
      const dir = String(pick(raw, "workspace.project_dir") ?? projectDir);
      console.log(statusLine({
        model: String(pick(raw, "model.display_name") ?? ""),
        branch: await currentBranch(dir),
        tokens: count(pick(raw, "context_window.total_input_tokens")),
        percent: optionalNumber(pick(raw, "context_window.used_percentage")),
        cost: count(pick(raw, "cost.total_cost_usd")),
        fiveHour: optionalNumber(
          pick(raw, "rate_limits.five_hour.used_percentage"),
        ),
        budget: contextBudget(),
      }));
      return;
    }
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
      const dir = stateDir(input.sessionId);
      if (dir !== undefined) await warnBudget(dir, input);
      return;
    }
    case "prompt": {
      const dir = stateDir(input.sessionId);
      if (dir === undefined) return;
      await Promise.all([
        treeSnapshot(projectDir).then((snap) => writeState(dir, "turn", snap)),
        warnBudget(dir, input),
      ]);
      return;
    }
    case "stop": {
      const dir = stateDir(input.sessionId);
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
  return MODES.some((mode) => mode === value);
}

if (import.meta.main) {
  const mode = Deno.args[0];
  // A broken hook must never break the session: fail open, silently.
  try {
    if (isMode(mode)) {
      await run(
        mode,
        JSON.parse(await new Response(Deno.stdin.readable).text()),
      );
    }
  } catch {
    // fail open
  }
}
