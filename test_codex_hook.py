import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import tempfile
import unittest

HOOK = Path(__file__).parent / "adapters" / "codex_hook.py"


class CodexHookTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.policy = root / "policy.json"
        self.policy.write_text(json.dumps({"profiles": {"lite": {"economy": 2, "converge": 3, "max": 4}}}))
        self.env = {
            **os.environ,
            "HARNESSPRO_PROFILE": "lite",
            "HARNESSPRO_POLICY": str(self.policy),
            "HARNESSPRO_STATE_DIR": str(root / "state"),
        }

    def tearDown(self):
        self.temp.cleanup()

    def call(self, event, call_id, session="session-one"):
        payload = {
            "hook_event_name": event,
            "session_id": session,
            "tool_use_id": call_id,
            "tool_name": "Bash",
            "tool_input": {"command": "printf test"},
        }
        result = subprocess.run(
            ["python3", str(HOOK)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            env=self.env,
            check=True,
        )
        return json.loads(result.stdout) if result.stdout.strip() else None

    def test_shared_budget_reminders_and_block(self):
        for count in range(1, 5):
            self.assertIsNone(self.call("PreToolUse", f"call-{count}"))
        economy = self.call("PostToolUse", "call-2")
        self.assertIn("Economy phase: 2", economy["hookSpecificOutput"]["additionalContext"])
        convergence = self.call("PostToolUse", "call-3")
        self.assertIn("Convergence phase: 3", convergence["hookSpecificOutput"]["additionalContext"])
        blocked = self.call("PreToolUse", "call-5")
        self.assertEqual(blocked["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertIn("4 calls", blocked["hookSpecificOutput"]["permissionDecisionReason"])

    def test_parallel_calls_share_one_budget(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(
                lambda count: self.call("PreToolUse", f"parallel-{count}", session="parallel-session"),
                range(1, 9),
            ))
        self.assertEqual(sum(result is None for result in results), 4)
        self.assertEqual(sum(result is not None for result in results), 4)

    def test_disabled_without_profile(self):
        self.env.pop("HARNESSPRO_PROFILE")
        self.assertIsNone(self.call("PreToolUse", "call-1"))


if __name__ == "__main__":
    unittest.main()
