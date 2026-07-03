#!/usr/bin/env bash
# Run eval across free Ollama models and aggregate potential scores.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

EVAL_DIR="$ROOT/eval"
RESULTS_DIR="${RESULTS_DIR:-$EVAL_DIR/results/ollama-matrix}"
PROFILE="${PROFILE:-standard}"
CONCURRENCY="${CONCURRENCY:-2}"
SHARDS="${SHARDS:-4}"

MODELS=(
  "qwen3-coder:30b"
  "llama3.1:8b"
  "deepseek-coder:6.7b"
  "codellama:7b"
)

BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434/v1}"

echo "Generating tasks (profile=$PROFILE)..."
node eval/scripts/generate-tasks.mjs --profile "$PROFILE"

mkdir -p "$RESULTS_DIR"

for model in "${MODELS[@]}"; do
  echo "=== Model: $model ==="
  MODEL_DIR="$RESULTS_DIR/$(echo "$model" | tr ':/' '--')"
  mkdir -p "$MODEL_DIR"

  for shard in $(seq 1 "$SHARDS"); do
  echo "  Shard $shard/$SHARDS"
    node eval/scripts/run-eval.mjs \
      --runtime real \
      --provider openai-compatible \
      --base-url "$BASE_URL" \
      --model "$model" \
      --approval auto \
      --concurrency "$CONCURRENCY" \
      --shard "$shard/$SHARDS" \
      --output "$MODEL_DIR/shard-${shard}.json" \
    || true
  done

  node eval/scripts/aggregate-results.mjs \
    --input "$MODEL_DIR" \
    --output "$MODEL_DIR/aggregated-report.json"
done

echo "Matrix complete. Results in $RESULTS_DIR"
