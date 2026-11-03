#!/usr/bin/env python3
"""Claude Code hook: warn once per session when context passes 250k tokens.

Reads the last assistant usage record from the session transcript. Runs on
PostToolUse and UserPromptSubmit; prints nothing below the threshold.
"""
import json, os, sys

WARN = int(os.environ.get("CONTEXT_BUDGET_WARN", "250000"))
STATE = os.path.expanduser("~/.claude/hooks/state")

try:
    hook = json.load(sys.stdin)
    path, sid = hook["transcript_path"], hook["session_id"]
    event = hook.get("hook_event_name", "PostToolUse")
    with open(path, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 400_000))
        lines = f.read().splitlines()
    used = 0
    for line in reversed(lines):
        try:
            u = json.loads(line)["message"]["usage"]
        except Exception:
            continue
        used = (u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0)
                + u.get("cache_creation_input_tokens", 0))
        break
    marker = os.path.join(STATE, f"{sid}.warned")
    if used < WARN or os.path.exists(marker):
        sys.exit(0)
    os.makedirs(STATE, exist_ok=True)
    open(marker, "w").close()
    msg = (f"Context is ~{used // 1000}k tokens (handoff rule: {WARN // 1000}k). Finish the "
           "current package at its next safe point, write a compact handoff "
           "(inputs, state, decision, next step) and tell the user to continue "
           "in a fresh session. Do not start new work in this one.")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event,
                                             "additionalContext": msg}}))
except Exception:
    sys.exit(0)
