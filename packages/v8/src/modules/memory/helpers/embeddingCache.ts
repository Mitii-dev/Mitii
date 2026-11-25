import { createHash } from "node:crypto";
import type { MemoryEmbeddingPort } from "../contracts";

const caches = new WeakMap<MemoryEmbeddingPort, Map<string, Float32Array>>();
const MAX_ENTRIES = 10_000;

/** Per-provider bounded cache; profile and preprocessing identity prevent reuse
 * of incompatible vectors even when two models have equal dimensions. */
export async function embedMemoryTexts(port: MemoryEmbeddingPort, texts: readonly string[],
  signal?: AbortSignal): Promise<readonly Float32Array[]> {
  signal?.throwIfAborted();
  const cache = caches.get(port) ?? new Map<string, Float32Array>();
  caches.set(port, cache);
  const keys = texts.map(text => createHash("sha256")
    .update(JSON.stringify([port.profileId ?? "instance", port.dimensions, "memory-v1", text])).digest("hex"));
  const missing = [...new Map(keys.flatMap((key, index) => cache.has(key) ? [] : [[key, texts[index]] as const])).entries()];
  if (missing.length) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Memory embedding cancelled or timed out.")), { once: true });
        timer = setTimeout(abort, 3_000);
        if (signal?.aborted) abort();
      });
      const work = async () => {
        const vectors: Float32Array[] = [];
        for (let i = 0; i < missing.length; i += 32) {
          controller.signal.throwIfAborted();
          const batch = missing.slice(i, i + 32).map(([, text]) => text);
          vectors.push(...(port.embedBatch ? await port.embedBatch(batch, controller.signal)
            : await Promise.all(batch.map(text => port.embed(text, controller.signal)))));
        }
        return vectors;
      };
      const vectors = await Promise.race([work(), deadline]);
      if (vectors.length !== missing.length || vectors.some(vector => vector.length !== port.dimensions ||
        !Array.from(vector).every(Number.isFinite))) throw new Error("Invalid memory embedding batch.");
      vectors.forEach((vector, i) => cache.set(missing[i][0], vector.slice()));
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  const result = keys.map(key => cache.get(key)!.slice());
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return result;
}
