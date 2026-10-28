#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys


def profile():
    policy_path = Path(os.environ.get("HARNESSPRO_POLICY", Path.home() / ".config" / "harnesspro" / "policy.json"))
    return json.loads(policy_path.read_text())["profiles"][os.environ["HARNESSPRO_PROFILE"]]


def state_path(session_id):
    root = Path(os.environ.get("HARNESSPRO_STATE_DIR", Path.home() / ".local" / "state" / "harnesspro"))
    digest = hashlib.sha256(session_id.encode()).hexdigest()
    return root / f"codex-{digest}.json"


def read_state(path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"count": 0, "calls": {}}


def next_count(session_id, call_id):
    path = state_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = read_state(path)
        state["count"] += 1
        state["calls"][call_id] = state["count"]
        temporary = path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(state))
        os.replace(temporary, path)
        return state["count"]


def call_count(session_id, call_id):
    path = state_path(session_id)
    with path.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_SH)
        return read_state(path)["calls"].get(call_id, 0)


def reminder(count, limits):
    if count == limits["economy"]:
        return f"Economy phase: {count} tool calls used. Combine checks and avoid repeated exploration."
    if count == limits["converge"]:
        return f"Convergence phase: {count} tool calls used. Stop broad exploration and verify the current result."
    if count == limits["max"]:
        return f"Tool budget reached: {count} calls. Preserve the current files and finish with existing evidence."
    return ""


def main():
    if not os.environ.get("HARNESSPRO_PROFILE"):
        return
    limits = profile()
    event = json.load(sys.stdin)
    event_name = event["hook_event_name"]
    session_id = event["session_id"]
    call_id = event["tool_use_id"]

    if event_name == "PreToolUse":
        count = next_count(session_id, call_id)
        if count > limits["max"]:
            reason = f"Tool budget exhausted ({limits['max']} calls). Finish with existing evidence."
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }}))
        return

    if event_name == "PostToolUse":
        note = reminder(call_count(session_id, call_id), limits)
        if note:
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"[harness-budget] {note}",
            }}))


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, OSError, json.JSONDecodeError):
        # ponytail: fail open on hook/state errors; switch to fail closed if budgets become security limits
        sys.exit(0)
