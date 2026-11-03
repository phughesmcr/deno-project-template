#!/bin/sh
# session-start | format | stop
set -u

mode=${1:-}
input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  if [ "$mode" = "stop" ]; then
    printf '%s\n' '{}'
  fi
  exit 0
fi

field() {
  printf '%s' "$input" | jq -er --arg k "$1" '.[$k] // empty' 2>/dev/null || true
}

ledger_path() {
  id=$(printf '%s' "$1" | tr -cd 'A-Za-z0-9_-')
  if [ -z "$id" ]; then
    return 1
  fi
  dir="${TMPDIR:-/tmp}/deno-project-template-hooks"
  mkdir -p "$dir" || return 1
  printf '%s/%s\n' "$dir" "$id"
}

case "$mode" in
  session-start)
    id=$(field session_id)
    if [ -z "$id" ]; then
      id=$(field conversation_id)
    fi
    path=$(ledger_path "$id") || exit 0
    rm -f "$path"
    ;;
  format)
    file=$(field file_path)
    root=$(printf '%s' "$input" | jq -er '.workspace_roots[0] // empty' 2>/dev/null || true)
    if [ -z "$root" ]; then
      exit 0
    fi
    case "$file" in
      "$root"/*.ts)
        deno fmt "$file" >/dev/null 2>&1 || true
        ;;
    esac
    id=$(field conversation_id)
    path=$(ledger_path "$id") || exit 0
    case "$file" in
      "$root"/src/*.ts|"$root"/tests/*.ts)
        printf '%s\n' "$file" >> "$path"
        ;;
    esac
    ;;
  stop)
    status=$(field status)
    if [ "$status" != "completed" ] || ! command -v deno >/dev/null 2>&1; then
      printf '%s\n' '{}'
      exit 0
    fi
    id=$(field conversation_id)
    path=$(ledger_path "$id") || {
      printf '%s\n' '{}'
      exit 0
    }
    if [ ! -s "$path" ]; then
      printf '%s\n' '{}'
      exit 0
    fi
    if output=$(deno task ci 2>&1); then
      rm -f "$path"
      printf '%s\n' '{}'
      exit 0
    fi
    tail=$(printf '%s\n' "$output" | tail -n 40)
    jq -n --arg tail "$tail" \
      '{followup_message: ("deno task ci failed. Fix the failures.\n\n" + $tail)}'
    ;;
esac
