#!/bin/bash
# Keep Deno check output short without losing the full log or exit code.
input=$(cat)
# Check equality in JSON before shell substitution can strip trailing newlines.
cmd=$(printf '%s' "$input" | jq -er '
  select(.hook_event_name == "PreToolUse" and .tool_name == "Bash") |
  .tool_input.command |
  select(. == "deno test" or . == "deno test --allow-env --allow-read" or
         . == "deno task test" or . == "deno task test:tools" or . == "deno task check")
' 2>/dev/null) || { printf '{}\n'; exit 0; }

printf -v filtered_cmd '%s\n' \
  'log=$(mktemp "${TMPDIR:-/tmp}/claude-test.XXXXXX") || exit $?' \
  'code=0' \
  "{ $cmd; } > \"\$log\" 2>&1 || code=\$?" \
  'if [ "$code" -eq 0 ]; then tail -n 5 "$log"; else tail -n 100 "$log"; fi' \
  'printf "\nexit code: %s (full log: %s)\n" "$code" "$log"' \
  'exit "$code"'
printf '%s' "$input" | jq --arg filtered "$filtered_cmd" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: (.tool_input + {command: $filtered})}}'
