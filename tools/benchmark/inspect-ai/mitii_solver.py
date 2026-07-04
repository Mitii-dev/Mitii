"""
Inspect AI solver adapter for Mitii CLI.

Install:
  pip install inspect-ai
  cd mitii-ai-agent && pnpm run compile:cli

Run (example):
  inspect eval tools/benchmark/inspect-ai/eval_tasks.py --model openai/gpt-4o-mini

Set MITII_PACKAGE_ROOT to the mitii-ai-agent directory if not cwd.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import Score, Scorer, Target, scorer, accuracy, mean
from inspect_ai.solver import Generate, Solver, TaskState, solver

PACKAGE_ROOT = Path(os.environ.get("MITII_PACKAGE_ROOT", Path(__file__).resolve().parents[3]))
BENCHMARK_ROOT = Path(os.environ.get("MITII_BENCHMARK_ROOT", PACKAGE_ROOT / "tools" / "benchmark"))
CLI = PACKAGE_ROOT / "dist" / "cli.js"
FIXTURE_ROOT = BENCHMARK_ROOT / "fixtures"
GENERATED_INDEX = BENCHMARK_ROOT / "tasks" / "eval" / "generated" / "index.json"


def _load_eval_samples(limit: int | None = 50) -> list[Sample]:
    if not GENERATED_INDEX.exists():
        subprocess.run(
            ["node", str(BENCHMARK_ROOT / "scripts/generate-tasks.mjs"), "--profile", "smoke"],
            check=True,
            cwd=PACKAGE_ROOT,
        )
    index = json.loads(GENERATED_INDEX.read_text())
    base = GENERATED_INDEX.parent
    tasks: list[dict] = []
    for rel in index.get("includes", []):
        tasks.extend(json.loads((base / rel).read_text()))
    if limit:
        tasks = tasks[:limit]
    return [
        Sample(
            id=t["id"],
            input=t["prompt"],
            target="pass",
            metadata={
                "mode": t.get("mode", "ask"),
                "fixture": t.get("fixture"),
                "verify": t.get("verify", []),
                "category": t.get("category"),
            },
        )
        for t in tasks
    ]


@solver
def mitii_cli_solver(
    provider: str = "echo",
    runtime: str = "stub",
    approval: str = "auto",
    model: str | None = None,
    base_url: str | None = None,
) -> Solver:
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        meta = state.sample_metadata or {}
        mode = meta.get("mode", "ask")
        fixture = meta.get("fixture")
        cwd = str(FIXTURE_ROOT / fixture) if fixture else str(PACKAGE_ROOT)

        cmd = [
            "node",
            str(CLI),
            mode,
            state.input_text,
            "--cwd",
            cwd,
            "--provider",
            provider,
            "--runtime",
            runtime,
            "--approval",
            approval,
        ]
        if model:
            cmd.extend(["--model", model])
        if base_url:
            cmd.extend(["--base-url", base_url])
        if mode != "ask":
            cmd.append("--json")

        proc = subprocess.run(
            cmd,
            cwd=PACKAGE_ROOT,
            capture_output=True,
            text=True,
            timeout=int(os.environ.get("MITII_EVAL_TIMEOUT_MS", "120000")) // 1000,
        )
        state.output.completion = proc.stdout
        state.metadata["mitii_exit_code"] = proc.returncode
        state.metadata["mitii_stderr"] = proc.stderr[:2000]
        state.metadata["mitii_passed"] = _score_output(
            proc.stdout, proc.returncode, meta.get("verify", []), cwd
        )
        return state

    return solve


def _score_output(stdout: str, exit_code: int, verify: list, cwd: str) -> bool:
    if exit_code != 0:
        return False
    for rule in verify:
        if isinstance(rule, str):
            if rule == "exit_0" and exit_code != 0:
                return False
            if rule == "stdout_not_empty" and not stdout.strip():
                return False
            if rule.startswith("stdout_contains:"):
                if rule.split(":", 1)[1] not in stdout:
                    return False
            if rule.startswith("json_path:"):
                key = rule.split(":", 1)[1]
                try:
                    if not json.loads(stdout).get(key):
                        return False
                except json.JSONDecodeError:
                    return False
            if rule.startswith("jsonl_event:"):
                ev = rule.split(":", 1)[1]
                if not any(
                    _safe_json(line).get("type") == ev
                    for line in stdout.splitlines()
                ):
                    return False
            if rule.startswith("file_exists:"):
                rel = rule.split(":", 1)[1]
                if not (Path(cwd) / rel).exists():
                    return False
    return True


def _safe_json(line: str) -> dict:
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return {}


@scorer(metrics=[accuracy(), mean()])
def mitii_verify_scorer() -> Scorer:
    async def score(state: TaskState, target: Target) -> Score:
        passed = bool(state.metadata.get("mitii_passed"))
        return Score(value=1.0 if passed else 0.0, answer="pass" if passed else "fail")

    return score


@task
def mitii_eval_smoke():
    return Task(
        dataset=_load_eval_samples(limit=10),
        solver=mitii_cli_solver(),
        scorer=mitii_verify_scorer(),
    )


@task
def mitii_eval_standard():
    return Task(
        dataset=_load_eval_samples(limit=500),
        solver=mitii_cli_solver(provider="openai-compatible", runtime="real"),
        scorer=mitii_verify_scorer(),
    )
